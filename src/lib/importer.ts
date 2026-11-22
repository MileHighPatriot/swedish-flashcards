// Turns parsed drafts into decks and cards: grouping by deck, duplicate
// detection, merge/skip, and the "Load starter lessons" loader.

import starterText from '../../seed/grammar-lessons-01-02.txt?raw';
import extrasText from '../../seed/lessons-01-02-extras.txt?raw';
import { db } from '../db/db';
import { SEED_TIME, alive, createDeck, createNotes, emptyNoteInput, findDeckByName, setNoteSuspended, updateNote, type NoteInput } from '../db/repo';
import type { Deck, DeckCategory, Draft, ID, Note, VocabCardType } from '../db/types';
import { SEED_ID_ALIASES } from '../data/seedIdAliases';
import { parseLesson, splitHint, type ParseResult, type ParsedItem } from './parser';
import { twoWordTime } from './timewords';

export interface DeckSpec {
  name: string;
  category: DeckCategory;
  locked?: boolean;
  description?: string;
  /** Overrides the default sibling cards for vocabulary in this deck. */
  cardTypes?: VocabCardType[];
}

export type RowAction = 'add' | 'merge' | 'skip';

export interface PlanRow {
  key: string;
  line: number;
  draft: Draft;
  action: RowAction;
  /** Set when a card with the same Swedish (or the same prompt) already exists. */
  duplicate: { noteId: ID | null; deckName: string; sameDeck: boolean } | null;
}

export interface PlanGroup {
  deck: DeckSpec;
  rows: PlanRow[];
}

export interface DraftGroup {
  deck: DeckSpec;
  items: { draft: Draft; line: number }[];
}

export interface ImportOptions {
  lessonNumber: number | null;
  lessonName: string;
  /** Added to every imported card, e.g. "lesson-03". */
  extraTags: string[];
  /** Sibling cards to create for vocabulary and phrases. */
  cardTypes: VocabCardType[];
  /** Built-in content: use fixed ids and timestamps so every device creates identical rows. */
  seed?: boolean;
}

export interface ImportResult {
  added: number;
  merged: number;
  skipped: number;
  /** Notes per deck name after the import (added + merged). */
  perDeck: Record<string, number>;
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** The key exactly as the text is written. Built-in ids are made from this one. */
function rawKey(d: Pick<Draft, 'kind' | 'swedish' | 'grammar'>): string {
  if (d.kind === 'vocab') return `vocab:${norm(d.swedish)}`;
  // The English hint on a reorder prompt is not part of the card's identity.
  const prompt = d.grammar?.prompt ?? '';
  return `${d.kind}:${norm(d.kind === 'reorder' ? splitHint(prompt).text : prompt)}`;
}

/** Two cards with the same key are the same card. "Igår" and "I går" count as the same spelling. */
export function dupKey(d: Pick<Draft, 'kind' | 'swedish' | 'grammar'>): string {
  return twoWordTime(rawKey(d));
}

/**
 * The fixed id of a built-in card. Ids were first handed out when the seed
 * files still wrote "igår" as one word; the alias table keeps those ids now
 * that the files say "i går", so no device ever sees a card change identity.
 */
export function seedNoteId(deckName: string, d: Pick<Draft, 'kind' | 'swedish' | 'grammar'>): ID {
  const id = seedNoteIdRaw(deckName, d);
  return SEED_ID_ALIASES[id] ?? id;
}

/** The id straight from the text, before the alias table. Only the alias generator needs this. */
export const seedNoteIdRaw = (deckName: string, d: Pick<Draft, 'kind' | 'swedish' | 'grammar'>): ID => `seed:${norm(deckName)}:${rawKey(d)}`;

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function lessonTag(n: number | null): string | null {
  return n == null ? null : `lesson-${pad2(n)}`;
}

/** "Lesson 07 – Family", "Lesson 07", "Family", or a fallback. */
export function lessonTitle(n: number | null, name: string): string {
  const nm = name.trim();
  if (n != null && nm) return `Lesson ${pad2(n)} – ${nm}`;
  if (n != null) return `Lesson ${pad2(n)}`;
  return nm || 'Imported';
}

export const MISTAKES_DECK = 'Grammar – My mistakes';

/**
 * Sort a pasted lesson into decks:
 *   vocabulary → "Lesson 03 – Name"            (Vocabulary)
 *   phrases    → "Phrases – Lesson 03 – Name"  (Phrases)
 *   rules, reorder, translate → "Grammar – Lesson 03 – Name" (Grammar)
 *   fix the error → "Grammar – My mistakes"    (one running deck of my own errors)
 */
export function groupLesson(parsed: ParseResult, lessonNumber: number | null, lessonName: string): DraftGroup[] {
  const title = lessonTitle(lessonNumber, lessonName);
  const specs: Record<string, DeckSpec> = {
    vocab: { name: title, category: 'vocab' },
    phrases: { name: `Phrases – ${title}`, category: 'phrases' },
    grammar: { name: `Grammar – ${title}`, category: 'grammar' },
    fix: { name: MISTAKES_DECK, category: 'grammar' },
  };
  const groups = new Map<string, DraftGroup>();
  for (const section of parsed.sections) {
    for (const item of section.items) {
      if (!item.draft) continue;
      const k = item.draft.kind;
      const bucket = k === 'vocab' ? (section.hint === 'phrases' ? 'phrases' : 'vocab') : k === 'fix' ? 'fix' : 'grammar';
      if (!groups.has(bucket)) groups.set(bucket, { deck: specs[bucket], items: [] });
      groups.get(bucket)!.items.push({ draft: item.draft, line: item.line });
    }
  }
  return ['vocab', 'phrases', 'grammar', 'fix'].flatMap((b) => (groups.has(b) ? [groups.get(b)!] : []));
}

export interface PlanPolicy {
  /** What to do with a card that already exists in the deck it is going to. */
  sameDeck: RowAction;
  /** What to do with a card that exists, but in a different deck. */
  otherDeck: RowAction;
}

export const DEFAULT_POLICY: PlanPolicy = { sameDeck: 'merge', otherDeck: 'skip' };

/** Compare drafts with what is already stored and propose an action per row. */
export async function buildPlan(groups: DraftGroup[], policy: PlanPolicy = DEFAULT_POLICY): Promise<PlanGroup[]> {
  const decks = alive(await db.decks.toArray());
  const deckById = new Map(decks.map((d) => [d.id, d]));
  const byKey = new Map<string, Note[]>();
  for (const n of alive(await db.notes.toArray())) {
    const k = dupKey(n);
    byKey.set(k, [...(byKey.get(k) ?? []), n]);
  }

  const seen = new Map<string, string>(); // key → deck name, for repeats inside this paste
  let counter = 0;
  return groups.map((g) => {
    const target = decks.find((d) => norm(d.name) === norm(g.deck.name));
    const rows = g.items.map(({ draft, line }): PlanRow => {
      const key = dupKey(draft);
      const row: PlanRow = { key: `r${counter++}`, line, draft, action: 'add', duplicate: null };
      const existing = byKey.get(key) ?? [];
      const same = target && existing.find((n) => n.deckId === target.id);
      const other = existing[0];
      if (same) {
        row.duplicate = { noteId: same.id, deckName: target.name, sameDeck: true };
        row.action = policy.sameDeck;
      } else if (seen.get(key) === norm(g.deck.name)) {
        row.duplicate = { noteId: null, deckName: g.deck.name, sameDeck: true };
        row.action = 'skip';
      } else if (other) {
        row.duplicate = { noteId: other.id, deckName: deckById.get(other.deckId)?.name ?? 'another deck', sameDeck: false };
        row.action = policy.otherDeck;
      }
      if (!seen.has(key)) seen.set(key, norm(g.deck.name));
      return row;
    });
    return { deck: g.deck, rows };
  });
}

const union = (a: string[], b: string[]) => {
  const out = [...a];
  for (const t of b) if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  return out;
};

const pick = (incoming: string, current: string) => (incoming.trim() ? incoming : current);

function mergeForms<T extends object>(current: T | null, incoming: T | null): T | null {
  if (!incoming) return current;
  if (!current) return incoming;
  const out = { ...current } as Record<string, unknown>;
  for (const [k, v] of Object.entries(incoming)) if (v) out[k] = v;
  return out as T;
}

/** Merge: new non-empty fields win, tags are combined, nothing is ever blanked. */
export function mergeDraft(existing: Note, d: Draft, extraTags: string[] = []): Partial<NoteInput> {
  return {
    english: pick(d.english, existing.english),
    pos: d.pos !== 'other' ? d.pos : existing.pos,
    exampleSv: pick(d.exampleSv, existing.exampleSv),
    exampleEn: pick(d.exampleEn, existing.exampleEn),
    notes: pick(d.notes, existing.notes),
    tags: union(union(existing.tags, d.tags), extraTags),
    noun: mergeForms(existing.noun, d.noun),
    verb: mergeForms(existing.verb, d.verb),
    adjective: mergeForms(existing.adjective, d.adjective),
    grammar:
      existing.grammar && d.grammar
        ? {
            prompt: existing.grammar.prompt,
            answer: pick(d.grammar.answer, existing.grammar.answer),
            explanation: pick(d.grammar.explanation, existing.grammar.explanation),
            topic: d.grammar.topic ?? existing.grammar.topic,
          }
        : existing.grammar,
  };
}

async function ensureDeck(spec: DeckSpec, opts: ImportOptions): Promise<Deck> {
  const found = await findDeckByName(spec.name);
  if (found) return found;
  return createDeck(
    {
      name: spec.name,
      category: spec.category,
      locked: spec.locked ?? false,
      description: spec.description ?? '',
      lessonNumber: opts.lessonNumber,
      lessonName: opts.lessonName,
    },
    opts.seed ? { id: `seed:deck:${norm(spec.name)}`, at: SEED_TIME } : {},
  );
}

/** Carry out a plan. Decks are created as needed; existing decks are added to. */
export async function applyPlan(groups: PlanGroup[], opts: ImportOptions): Promise<ImportResult> {
  const result: ImportResult = { added: 0, merged: 0, skipped: 0, perDeck: {} };
  for (const g of groups) {
    const active = g.rows.filter((r) => r.action !== 'skip');
    result.skipped += g.rows.length - active.length;
    if (active.length === 0 || !g.deck.name.trim()) continue;
    const deck = await ensureDeck(g.deck, opts);

    const toAdd: NoteInput[] = [];
    for (const row of active) {
      const existing = row.action === 'merge' && row.duplicate?.noteId ? await db.notes.get(row.duplicate.noteId) : undefined;
      if (existing && existing.deletedAt == null) {
        await updateNote(existing.id, mergeDraft(existing, row.draft, opts.extraTags));
        result.merged++;
      } else {
        toAdd.push({
          ...emptyNoteInput(deck.id, g.deck.cardTypes ?? opts.cardTypes),
          ...row.draft,
          tags: union(row.draft.tags, opts.extraTags),
          lessonNumber: opts.lessonNumber,
          lessonName: opts.lessonName,
        });
      }
    }
    // Built-in rows that already exist under their fixed id are left alone, so count what was really made.
    if (toAdd.length)
      result.added += (await createNotes(toAdd, opts.seed ? { idFor: (n) => seedNoteId(deck.name, n), at: SEED_TIME } : {})).length;
    result.perDeck[deck.name] = (result.perDeck[deck.name] ?? 0) + active.length;
  }
  return result;
}

// ---------- starter lessons ----------

export const GRAMMAR_DECK_01_02 = 'Grammar – Past tense & word order';

/** Section headings in the starter file that do not name their own deck. */
const STARTER_DECK_OVERRIDES: Record<string, string> = {
  'reorder cards': GRAMMAR_DECK_01_02,
  'translate cards': GRAMMAR_DECK_01_02,
};

function starterDeckFor(heading: string): DeckSpec {
  const bare = heading.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const name = STARTER_DECK_OVERRIDES[bare.toLowerCase()] ?? bare;
  const lower = name.toLowerCase();
  const locked = lower.startsWith('coming soon');
  const category: DeckCategory = lower.startsWith('grammar') ? 'grammar' : lower.includes('phrases') ? 'phrases' : 'vocab';
  return {
    name,
    category,
    locked,
    description: locked ? 'Locked until you unlock it. Its cards stay out of your reviews until then.' : '',
    // Spelling words are practised by typing them, not by recognising them.
    cardTypes: lower.includes('spelling') ? ['basic', 'typed'] : undefined,
  };
}

export function groupStarter(parsed: ParseResult): DraftGroup[] {
  const groups = new Map<string, DraftGroup>();
  for (const section of parsed.sections) {
    const deck = starterDeckFor(section.heading);
    if (!groups.has(deck.name)) groups.set(deck.name, { deck, items: [] });
    for (const item of section.items)
      if (item.draft) groups.get(deck.name)!.items.push({ draft: item.draft, line: item.line });
  }
  return [...groups.values()];
}

export interface StarterResult extends ImportResult {
  /** Lines in the starter file that could not be parsed. */
  errors: ParsedItem[];
}

/**
 * Load the files in seed/. Safe to run again: cards already in
 * their deck are left alone (your scheduling and edits are kept).
 */
export const STARTER_TEXTS: string[] = [starterText, extrasText];

/** Built-in rows are stamped inside this window; anything later was edited by me. */
const SEED_WINDOW = 1_000_000;
/** The stamp of a built-in row that a revision changed: still inside the window, so it never uploads. */
const REFRESH_STAMP = SEED_TIME + SEED_WINDOW - 1;
const untouched = (row: { updatedAt: number }) => row.updatedAt < SEED_TIME + SEED_WINDOW;

/**
 * Bring built-in grammar cards up to date when the starter files change (for
 * example, when the English meaning was added to reorder cards). Only cards I
 * have never edited are touched, their review history is kept, and the new
 * timestamp is fixed, so every device ends up with identical rows.
 */
export async function refreshStarterCards(texts: string[] = STARTER_TEXTS): Promise<number> {
  let changed = 0;
  for (const text of texts) {
    for (const group of groupStarter(parseLesson(text))) {
      for (const { draft } of group.items) {
        if (!draft.grammar) continue;
        const note = await db.notes.get(seedNoteId(group.deck.name, draft));
        if (!note?.grammar || note.deletedAt != null || note.updatedAt >= SEED_TIME + SEED_WINDOW) continue;
        const { prompt, answer, explanation } = draft.grammar;
        if (note.grammar.prompt === prompt && note.grammar.answer === answer && note.grammar.explanation === explanation) continue;
        await db.notes.update(note.id, { grammar: { ...note.grammar, prompt, answer, explanation }, updatedAt: REFRESH_STAMP });
        changed++;
      }
    }
  }
  return changed;
}

export async function loadStarterLessons(texts: string[] = STARTER_TEXTS): Promise<StarterResult> {
  // Parse the files as one document; line numbers in errors are per file.
  const parts = texts.map((t) => parseLesson(t));
  const parsed: ParseResult = {
    sections: parts.flatMap((p) => p.sections),
    errors: parts.flatMap((p) => p.errors),
    count: parts.reduce((n, p) => n + p.count, 0),
  };
  const plan = await buildPlan(groupStarter(parsed), { sameDeck: 'skip', otherDeck: 'add' });
  const result = await applyPlan(plan, {
    lessonNumber: null,
    lessonName: '',
    extraTags: [],
    cardTypes: ['basic', 'reverse'],
    seed: true,
  });
  return { ...result, errors: parsed.errors };
}

// ---------- built-in lessons (Lesson 3 onwards) ----------

export interface BuiltInLesson {
  /** File name in seed/. Remembered once loaded, so a lesson is only ever loaded once. */
  key: string;
  number: number | null;
  name: string;
  text: string;
}

/** Reads "# Lesson 03 – Irregular verbs" from the top of a lesson file. */
export function readLessonTitle(text: string): { number: number | null; name: string } {
  const m = /^#\s*Lesson\s+(\d+)\s*(?:[-–—:]\s*(.*?))?\s*$/im.exec(text);
  return m ? { number: Number(m[1]), name: (m[2] ?? '').trim() } : { number: null, name: '' };
}

export const toBuiltInLesson = (key: string, text: string): BuiltInLesson => ({ key, text, ...readLessonTitle(text) });

// Every seed/lesson-NN-*.txt file is a built-in lesson. To add one, drop the file in.
const lessonFiles = import.meta.glob<string>('../../seed/lesson-*.txt', { query: '?raw', import: 'default', eager: true });

export const BUILT_IN_LESSONS: BuiltInLesson[] = Object.keys(lessonFiles)
  .sort()
  .map((path) => toBuiltInLesson(path.split('/').pop()!, lessonFiles[path]));

export interface LessonResult extends ImportResult {
  /** Words brought over from a locked "coming soon" deck. */
  moved: number;
  errors: ParsedItem[];
}

/**
 * Load a lesson file the way "Paste lesson" would, as built-in content (fixed
 * ids, so every device makes the same rows). Cards that already exist:
 *   - in the lesson's own decks: left alone;
 *   - a word waiting in a locked "coming soon" deck: moved into the lesson and
 *     unlocked, with the lesson's forms, example and tags;
 *   - a grammar card with the same prompt in another deck: updated in place
 *     with the lesson's wording and tags (unless I have edited it), not doubled;
 *   - a word in another open deck: added to the lesson as well.
 */
export async function loadBuiltInLesson(lesson: BuiltInLesson): Promise<LessonResult> {
  const parsed = parseLesson(lesson.text);
  const tag = lessonTag(lesson.number);
  const opts: ImportOptions = {
    lessonNumber: lesson.number,
    lessonName: lesson.name,
    extraTags: tag ? [tag] : [],
    cardTypes: ['basic', 'reverse'],
    seed: true,
  };
  const plan = await buildPlan(groupLesson(parsed, lesson.number, lesson.name), { sameDeck: 'skip', otherDeck: 'add' });

  const decks = new Map(alive(await db.decks.toArray()).map((d) => [d.id, d]));
  const byKey = new Map<string, Note[]>();
  for (const n of alive(await db.notes.toArray())) {
    const k = dupKey(n);
    byKey.set(k, [...(byKey.get(k) ?? []), n]);
  }

  let moved = 0;
  let merged = 0;
  for (const group of plan) {
    for (const row of group.rows) {
      if (row.action !== 'add' || !row.duplicate || row.duplicate.sameDeck) continue;
      const twins = byKey.get(dupKey(row.draft)) ?? [];
      if (row.draft.kind === 'vocab') {
        const waiting = twins.find((n) => decks.get(n.deckId)?.locked);
        if (!waiting) continue;
        const deck = await ensureDeck(group.deck, opts);
        await updateNote(waiting.id, {
          ...mergeDraft(waiting, row.draft, opts.extraTags),
          deckId: deck.id,
          lessonNumber: lesson.number,
          lessonName: lesson.name,
        });
        await setNoteSuspended(waiting.id, false);
        moved++;
      } else if (twins[0]) {
        if (twins[0].updatedAt < SEED_TIME + SEED_WINDOW) {
          await updateNote(twins[0].id, mergeDraft(twins[0], row.draft, opts.extraTags));
          merged++;
        }
      } else continue;
      row.action = 'skip';
    }
  }

  const result = await applyPlan(plan, opts);
  return { ...result, merged: result.merged + merged, skipped: result.skipped - moved - merged, moved, errors: parsed.errors };
}

// ---------- revisions of built-in content ----------

/**
 * Built-in cards that were wrong and are taken out again. A card is only ever
 * removed by being listed here; one that is merely missing from a file is left alone.
 */
export const REMOVED_SEED_IDS: ID[] = [
  // "Vi såg på film" is correct Swedish, so this fix card taught a mistake.
  'seed:grammar – my mistakes:fix:vi såg på film.',
];

const VOCAB_FIELDS = ['swedish', 'english', 'pos', 'exampleSv', 'exampleEn', 'notes', 'noun', 'verb', 'adjective'] as const;

/** Every built-in card as the seed files describe it now, with its fixed id. */
export function builtInDrafts(starter: string[] = STARTER_TEXTS, lessons: BuiltInLesson[] = BUILT_IN_LESSONS): { id: ID; draft: Draft }[] {
  const groups = [
    ...starter.flatMap((text) => groupStarter(parseLesson(text))),
    ...lessons.flatMap((l) => groupLesson(parseLesson(l.text), l.number, l.name)),
  ];
  // Two files can hold the same card (a mistake repeated in a later lesson). The
  // first file wins, exactly as it does when the lessons are loaded in order.
  const seen = new Set<ID>();
  return groups.flatMap((g) =>
    g.items.flatMap(({ draft }) => {
      const id = seedNoteId(g.deck.name, draft);
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ id, draft }];
    }),
  );
}

/**
 * Bring the built-in cards on this device up to the current seed files.
 *   - A card I have never edited gets the new wording in place (words and grammar
 *     alike). Its id, its sibling cards and its review history stay as they are,
 *     and the new stamp is fixed, so every device ends up identical and nothing uploads.
 *   - Cards on the removal list are soft-deleted.
 *   - Every built-in card, edited or not, gets "igår" style time words written as
 *     two words. That is a spelling change only, so my own edits survive it.
 * Returns how many cards changed.
 */
export async function refreshBuiltIn(starter: string[] = STARTER_TEXTS, lessons: BuiltInLesson[] = BUILT_IN_LESSONS): Promise<number> {
  let changed = 0;
  await db.transaction('rw', db.notes, db.cards, async () => {
    for (const { id, draft } of builtInDrafts(starter, lessons)) {
      const note = await db.notes.get(id);
      if (!note || note.deletedAt != null || !untouched(note) || note.kind !== draft.kind) continue;
      const patch: Partial<Note> = {};
      if (draft.kind === 'vocab') {
        for (const f of VOCAB_FIELDS) if (JSON.stringify(note[f]) !== JSON.stringify(draft[f])) (patch as Record<string, unknown>)[f] = draft[f];
      } else if (note.grammar && draft.grammar) {
        const { prompt, answer, explanation } = draft.grammar;
        if (note.grammar.prompt !== prompt || note.grammar.answer !== answer || note.grammar.explanation !== explanation)
          patch.grammar = { ...note.grammar, prompt, answer, explanation };
      }
      if (Object.keys(patch).length === 0) continue;
      await db.notes.update(id, { ...patch, updatedAt: REFRESH_STAMP });
      changed++;
    }

    for (const id of REMOVED_SEED_IDS) {
      const note = await db.notes.get(id);
      if (!note || note.deletedAt != null) continue;
      const now = Date.now();
      // An untouched row keeps a seed stamp; one with history is deleted like any other row, so the delete syncs.
      const stamp = (row: { updatedAt: number }) => (untouched(row) ? REFRESH_STAMP : now);
      await db.notes.update(id, { deletedAt: stamp(note), updatedAt: stamp(note) });
      await db.cards.where('noteId').equals(id).modify((c) => {
        if (c.deletedAt != null) return;
        c.deletedAt = c.updatedAt = stamp(c);
      });
      changed++;
    }

    // Built-in cards that a later lesson moved or merged carry a newer stamp, so
    // the pass above skips them. Their time words are still brought into line.
    await db.notes
      .where('id')
      .startsWith('seed:')
      .modify((n) => {
        if (n.deletedAt != null) return;
        const before = JSON.stringify([n.swedish, n.exampleSv, n.notes, n.grammar]);
        n.swedish = twoWordTime(n.swedish);
        n.exampleSv = twoWordTime(n.exampleSv);
        n.notes = twoWordTime(n.notes);
        if (n.grammar) n.grammar = { ...n.grammar, prompt: twoWordTime(n.grammar.prompt), answer: twoWordTime(n.grammar.answer), explanation: twoWordTime(n.grammar.explanation) };
        if (JSON.stringify([n.swedish, n.exampleSv, n.notes, n.grammar]) === before) return;
        if (untouched(n)) n.updatedAt = REFRESH_STAMP;
        changed++;
      });
  });
  return changed;
}
