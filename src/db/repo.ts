// Repository: the only module that writes to the database. Every mutation
// stamps `updatedAt` and deletes are tombstones, so a future sync adapter can
// push/pull "rows changed since X" without the UI knowing.

import { db } from './db';
import {
  CardState,
  DEFAULT_SETTINGS,
  type Card,
  type CardType,
  type Deck,
  type Grade,
  type GrammarPage,
  type ID,
  type Media,
  type Mistake,
  type Note,
  type NoteKind,
  type VocabCardType,
  type ReviewLog,
  type SchedState,
  type Settings,
  type SyncMeta,
} from './types';
import { newSchedState, studyDayEnd, studyDayStart } from '../lib/scheduler';
import { DEFAULT_PAGES } from '../data/grammarPages';

export const newId = (): ID => crypto.randomUUID();

function meta(now = Date.now(), id: ID = newId()): SyncMeta {
  return { id, createdAt: now, updatedAt: now, deletedAt: null };
}

/**
 * Built-in content (sample deck, starter lessons, grammar pages) is created
 * with fixed ids and this fixed, old timestamp on every device. That way two
 * devices that each seed themselves end up with the same rows, and when they
 * sync, any real progress (which is always newer) wins over a fresh copy.
 */
export const SEED_TIME = Date.UTC(2026, 0, 1);

export interface SeedOptions {
  /** Stable id for the row, the same on every device. */
  id?: ID;
  at?: number;
}

export const alive = <T extends SyncMeta>(rows: T[]): T[] => rows.filter((r) => r.deletedAt == null);

// ---------- settings ----------

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const current = await getSettings();
    await db.kv.put({ key: 'settings', value: { ...current, ...patch }, updatedAt: Date.now() });
  });
}

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value, updatedAt: Date.now() });
}

// ---------- decks ----------

export async function listDecks(): Promise<Deck[]> {
  const decks = alive(await db.decks.toArray());
  // Locked ("coming soon") decks go last.
  return decks.sort((a, b) => Number(!!a.locked) - Number(!!b.locked) || a.name.localeCompare(b.name, 'sv', { numeric: true }));
}

export async function getDeck(id: ID): Promise<Deck | undefined> {
  const d = await db.decks.get(id);
  return d && d.deletedAt == null ? d : undefined;
}

export async function findDeckByName(name: string): Promise<Deck | undefined> {
  const wanted = name.trim().toLowerCase();
  return alive(await db.decks.toArray()).find((d) => d.name.trim().toLowerCase() === wanted);
}

export type DeckInput = Pick<Deck, 'name'> & Partial<Pick<Deck, 'category' | 'lessonNumber' | 'lessonName' | 'description' | 'locked'>>;

export async function createDeck(input: DeckInput, seed: SeedOptions = {}): Promise<Deck> {
  const deck: Deck = {
    ...meta(seed.at, seed.id),
    name: input.name.trim(),
    category: input.category ?? 'vocab',
    lessonNumber: input.lessonNumber ?? null,
    lessonName: input.lessonName ?? '',
    description: input.description ?? '',
    locked: input.locked ?? false,
  };
  await db.decks.add(deck);
  return deck;
}

export async function updateDeck(id: ID, patch: Partial<Omit<Deck, keyof SyncMeta>>): Promise<void> {
  await db.decks.update(id, { ...patch, updatedAt: Date.now() });
}

/** Deletes a deck and everything in it (tombstones). */
export async function deleteDeck(id: ID): Promise<void> {
  const now = Date.now();
  const stamp = { deletedAt: now, updatedAt: now };
  await db.transaction('rw', db.decks, db.notes, db.cards, async () => {
    await db.decks.update(id, stamp);
    await db.notes.where('deckId').equals(id).modify(stamp);
    await db.cards.where('deckId').equals(id).modify(stamp);
  });
}

/** Unlock a "coming soon" deck: its suspended cards become ordinary new cards. */
export async function unlockDeck(id: ID): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.decks, db.cards, async () => {
    await db.decks.update(id, { locked: false, updatedAt: now });
    await db.cards
      .where('deckId')
      .equals(id)
      .modify((c) => {
        if (c.deletedAt == null && c.suspended) {
          c.suspended = false;
          c.updatedAt = now;
        }
      });
  });
}

// ---------- notes + sibling cards ----------

export type NoteInput = Omit<Note, keyof SyncMeta>;

export function emptyNoteInput(deckId: ID, cardTypes: VocabCardType[] = ['basic', 'reverse']): NoteInput {
  return {
    deckId,
    kind: 'vocab',
    grammar: null,
    swedish: '',
    english: '',
    pos: 'other',
    exampleSv: '',
    exampleEn: '',
    notes: '',
    tags: [],
    lessonNumber: null,
    lessonName: '',
    noun: null,
    verb: null,
    adjective: null,
    audioId: null,
    imageId: null,
    cardTypes,
  };
}

/**
 * Vocab: 'basic' is always present, no duplicates, stable order.
 * Grammar: exactly one card, of the note's kind.
 */
export function normaliseCardTypes(kind: NoteKind, types: CardType[]): CardType[] {
  if (kind !== 'vocab') return [kind];
  const order: CardType[] = ['basic', 'reverse', 'cloze', 'typed', 'listening'];
  const set = new Set<CardType>(['basic', ...types]);
  return order.filter((t) => set.has(t));
}

function makeCard(note: Note, type: CardType, now: number, suspended = false, id?: ID): Card {
  return {
    ...meta(now, id),
    ...newSchedState(now),
    noteId: note.id,
    deckId: note.deckId,
    type,
    suspended,
    leech: false,
  };
}

export async function createNote(input: NoteInput): Promise<Note> {
  const [note] = await createNotes([input]);
  return note;
}

export interface SeedNotesOptions {
  /** Stable note id per input, the same on every device. Cards get "<noteId>:<type>". */
  idFor?: (input: NoteInput) => ID;
  at?: number;
}

/** Cards are created suspended when their deck is locked ("coming soon"). */
export async function createNotes(inputs: NoteInput[], seed: SeedNotesOptions = {}): Promise<Note[]> {
  const now = seed.at ?? Date.now();
  if (seed.idFor) {
    // Never overwrite a row that already exists under a fixed id (even a deleted one).
    const existing = new Set((await db.notes.bulkGet(inputs.map(seed.idFor))).filter(Boolean).map((n) => n!.id));
    inputs = inputs.filter((i) => !existing.has(seed.idFor!(i)));
  }
  const locked = new Set(alive(await db.decks.toArray()).filter((d) => d.locked).map((d) => d.id));
  const notes: Note[] = [];
  const cards: Card[] = [];
  inputs.forEach((input, i) => {
    // Offset createdAt by 1ms each so "order added" is stable within an import.
    const note: Note = { ...meta(now + i, seed.idFor?.(input)), ...input, cardTypes: normaliseCardTypes(input.kind, input.cardTypes) };
    notes.push(note);
    for (const type of note.cardTypes)
      cards.push(makeCard(note, type, now + i, locked.has(note.deckId), seed.idFor ? `${note.id}:${type}` : undefined));
  });
  await db.transaction('rw', db.notes, db.cards, async () => {
    await db.notes.bulkAdd(notes);
    await db.cards.bulkAdd(cards);
  });
  return notes;
}

/**
 * Update a note and reconcile its sibling cards: newly enabled types get a
 * fresh card, disabled types are tombstoned, re-enabled types are restored
 * with their old scheduling history.
 */
export async function updateNote(id: ID, patch: Partial<NoteInput>): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.notes, db.cards, async () => {
    const existing = await db.notes.get(id);
    if (!existing) return;
    const note: Note = { ...existing, ...patch, updatedAt: now };
    note.cardTypes = normaliseCardTypes(note.kind, note.cardTypes);
    await db.notes.put(note);

    const siblings = await db.cards.where('noteId').equals(id).toArray();
    for (const type of note.cardTypes) {
      const card = siblings.find((c) => c.type === type);
      if (!card) await db.cards.add(makeCard(note, type, now));
      else if (card.deletedAt != null || card.deckId !== note.deckId)
        await db.cards.update(card.id, { deletedAt: null, deckId: note.deckId, updatedAt: now });
    }
    for (const card of siblings) {
      if (card.deletedAt == null && !note.cardTypes.includes(card.type))
        await db.cards.update(card.id, { deletedAt: now, updatedAt: now });
    }
  });
}

export async function deleteNote(id: ID): Promise<void> {
  const now = Date.now();
  const stamp = { deletedAt: now, updatedAt: now };
  await db.transaction('rw', db.notes, db.cards, async () => {
    await db.notes.update(id, stamp);
    await db.cards.where('noteId').equals(id).modify(stamp);
  });
}

export async function getNote(id: ID): Promise<Note | undefined> {
  const n = await db.notes.get(id);
  return n && n.deletedAt == null ? n : undefined;
}

export async function listNotes(deckId?: ID): Promise<Note[]> {
  const rows = deckId ? await db.notes.where('deckId').equals(deckId).toArray() : await db.notes.toArray();
  return alive(rows).sort((a, b) => a.createdAt - b.createdAt);
}

export async function listTags(): Promise<string[]> {
  const tags = new Set<string>();
  for (const n of alive(await db.notes.toArray())) for (const t of n.tags) tags.add(t);
  return [...tags].sort((a, b) => a.localeCompare(b, 'sv'));
}

// ---------- cards ----------

export async function listCards(deckId?: ID): Promise<Card[]> {
  const rows = deckId ? await db.cards.where('deckId').equals(deckId).toArray() : await db.cards.toArray();
  return alive(rows);
}

export async function getCard(id: ID): Promise<Card | undefined> {
  const c = await db.cards.get(id);
  return c && c.deletedAt == null ? c : undefined;
}

export async function setSuspended(cardId: ID, suspended: boolean): Promise<void> {
  await db.cards.update(cardId, { suspended, updatedAt: Date.now() });
}

// ---------- reviews ----------

export interface ReviewInput {
  card: Card;
  next: SchedState;
  rating: Grade;
  reviewedAt: number;
  durationMs: number;
  leech: boolean;
}

/** Persist the outcome of a rating: the card's new schedule plus a log row. */
export async function saveReview(input: ReviewInput): Promise<ReviewLog> {
  const { card, next, rating, reviewedAt, durationMs, leech } = input;
  const log: ReviewLog = {
    ...meta(reviewedAt),
    cardId: card.id,
    noteId: card.noteId,
    deckId: card.deckId,
    rating,
    state: card.state,
    reviewedAt,
    scheduledDays: next.scheduledDays,
    stability: next.stability,
    difficulty: next.difficulty,
    durationMs,
    cram: false,
  };
  await db.transaction('rw', db.cards, db.reviews, async () => {
    await db.cards.update(card.id, { ...next, leech, updatedAt: reviewedAt });
    await db.reviews.add(log);
  });
  return log;
}

/** Log a cram review. Scheduling is untouched. */
export async function saveCramReview(card: Card, rating: Grade, reviewedAt: number, durationMs: number): Promise<ReviewLog> {
  const log: ReviewLog = {
    ...meta(reviewedAt),
    cardId: card.id,
    noteId: card.noteId,
    deckId: card.deckId,
    rating,
    state: card.state,
    reviewedAt,
    scheduledDays: card.scheduledDays,
    stability: card.stability,
    difficulty: card.difficulty,
    durationMs,
    cram: true,
  };
  await db.reviews.add(log);
  return log;
}

/** Undo: put the card back exactly as it was and tombstone the log row. */
export async function undoReview(previous: Card, logId: ID): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.cards, db.reviews, async () => {
    await db.cards.put({ ...previous, updatedAt: now });
    await db.reviews.update(logId, { deletedAt: now, updatedAt: now });
  });
}

export async function listReviews(since = 0): Promise<ReviewLog[]> {
  return alive(await db.reviews.where('reviewedAt').aboveOrEqual(since).toArray());
}

/** Cram undo: the log row is tombstoned; scheduling was never touched. */
export async function removeReview(logId: ID): Promise<void> {
  const now = Date.now();
  await db.reviews.update(logId, { deletedAt: now, updatedAt: now });
}

/** Suspend or bring back every card of a note. */
export async function setNoteSuspended(noteId: ID, suspended: boolean): Promise<void> {
  const now = Date.now();
  await db.cards
    .where('noteId')
    .equals(noteId)
    .modify((c) => {
      if (c.deletedAt == null) {
        c.suspended = suspended;
        c.updatedAt = now;
      }
    });
}

// ---------- grammar notes ----------

export async function listGrammarPages(): Promise<GrammarPage[]> {
  return alive(await db.grammarPages.toArray()).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export async function getGrammarPage(slug: string): Promise<GrammarPage | undefined> {
  return alive(await db.grammarPages.where('slug').equals(slug).toArray())[0];
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'page'
  );
}

export async function createGrammarPage(title: string, markdown = ''): Promise<GrammarPage> {
  const pages = await listGrammarPages();
  let slug = slugify(title);
  for (let i = 2; pages.some((p) => p.slug === slug); i++) slug = `${slugify(title)}-${i}`;
  const page: GrammarPage = {
    ...meta(),
    slug,
    title: title.trim() || 'Untitled',
    markdown: markdown || `# ${title.trim() || 'Untitled'}\n\n`,
    order: Math.max(0, ...pages.map((p) => p.order)) + 1,
  };
  await db.grammarPages.add(page);
  return page;
}

export async function updateGrammarPage(id: ID, patch: Partial<Pick<GrammarPage, 'title' | 'markdown' | 'order'>>): Promise<void> {
  await db.grammarPages.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteGrammarPage(id: ID): Promise<void> {
  const now = Date.now();
  await db.grammarPages.update(id, { deletedAt: now, updatedAt: now });
}

/**
 * Add any built-in page this device does not have yet. Edited pages are never
 * overwritten, and a deleted page keeps its (tombstoned) row, so it stays deleted.
 */
export async function ensureGrammarPages(): Promise<void> {
  const have = new Set((await db.grammarPages.toArray()).map((p) => p.slug));
  const missing = DEFAULT_PAGES.map((p, i) => ({
    ...meta(SEED_TIME, `page:${p.slug}`),
    slug: p.slug,
    title: p.title,
    markdown: p.markdown,
    order: p.order ?? i + 1,
  })).filter((p) => !have.has(p.slug));
  if (missing.length) await db.grammarPages.bulkAdd(missing);
}

// ---------- media (recordings, images) ----------

export async function saveMedia(kind: Media['kind'], file: Blob): Promise<Media> {
  const m: Media = { ...meta(), kind, mime: file.type || (kind === 'audio' ? 'audio/mpeg' : 'image/png'), blob: file };
  await db.media.add(m);
  return m;
}

/** Tombstone a recording and drop its bytes. */
export async function removeMedia(id: ID): Promise<void> {
  const now = Date.now();
  await db.media.update(id, { deletedAt: now, updatedAt: now, blob: new Blob([]) });
}

// ---------- mistake log ----------

export async function addMistake(input: Omit<Mistake, keyof SyncMeta>): Promise<Mistake> {
  const m: Mistake = { ...meta(input.at), ...input };
  await db.mistakes.add(m);
  return m;
}

export async function removeMistake(id: ID): Promise<void> {
  const now = Date.now();
  await db.mistakes.update(id, { deletedAt: now, updatedAt: now });
}

export async function listMistakes(): Promise<Mistake[]> {
  return alive(await db.mistakes.toArray()).sort((a, b) => b.at - a.at);
}

// ---------- today's workload ----------

export interface TodayCounts {
  /** New cards that will be introduced today (after the daily limit). */
  newToday: number;
  /** Cards in (re)learning steps due today. */
  learning: number;
  /** Graduated reviews due today (after the daily limit). */
  reviewToday: number;
  /** learning + reviewToday */
  dueToday: number;
  /** Reviews already done today (excluding cram). */
  doneToday: number;
  totalCards: number;
}

export function countToday(cards: Card[], logsToday: ReviewLog[], settings: Settings, now: number): TodayCounts {
  const dayEnd = studyDayEnd(now, settings.dayStartHour);
  const active = cards.filter((c) => c.deletedAt == null && !c.suspended);
  const real = logsToday.filter((l) => l.deletedAt == null && !l.cram);
  const newDone = new Set(real.filter((l) => l.state === CardState.New).map((l) => l.cardId)).size;
  const reviewsDone = real.filter((l) => l.state === CardState.Review).length;

  const newAvailable = active.filter((c) => c.state === CardState.New).length;
  const learning = active.filter(
    (c) => (c.state === CardState.Learning || c.state === CardState.Relearning) && c.due < dayEnd,
  ).length;
  const reviewDue = active.filter((c) => c.state === CardState.Review && c.due < dayEnd).length;

  const newToday = Math.min(newAvailable, Math.max(0, settings.newPerDay - newDone));
  const reviewToday = Math.min(reviewDue, Math.max(0, settings.reviewsPerDay - reviewsDone));
  return {
    newToday,
    learning,
    reviewToday,
    dueToday: learning + reviewToday,
    doneToday: real.length,
    totalCards: active.length,
  };
}

export async function getTodayCounts(now = Date.now(), deckId?: ID): Promise<TodayCounts> {
  const settings = await getSettings();
  const [cards, logs] = await Promise.all([
    listCards(deckId),
    listReviews(studyDayStart(now, settings.dayStartHour)),
  ]);
  return countToday(cards, logs, settings, now);
}
