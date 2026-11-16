// Builds a study session and steps through it. Pure functions: no database,
// no clock, no randomness of their own (all passed in), so they are testable.

import {
  CardState,
  type Card,
  type CardType,
  type Deck,
  type DeckCategory,
  type ID,
  type Note,
  type ReviewLog,
  type Settings,
} from '../db/types';
import { studyDayEnd } from './scheduler';

export interface Scope {
  deckId?: ID;
  category?: DeckCategory;
  tag?: string;
}

export interface QueueOptions extends Scope {
  /** 'cram' ignores scheduling: every card in scope, nothing rescheduled. */
  mode: 'normal' | 'cram';
  shuffle: boolean;
  /** Extra new cards beyond today's limit ("learn 10 more"). */
  extraNew?: number;
  /** Cram exactly these cards, in this order (weak spots, practise a rule). */
  cardIds?: ID[];
}

export interface QueueInput {
  cards: Card[];
  notes: Note[];
  decks: Deck[];
  /** Non-cram reviews done since the start of the study day. */
  logsToday: ReviewLog[];
  settings: Settings;
  now: number;
  rng?: () => number;
}

export interface Queue {
  /** Cards in (re)learning steps: shown as soon as their timer is up. */
  learning: ID[];
  /** Reviews and new cards, in the order they will be shown. */
  main: ID[];
  counts: { learning: number; review: number; new: number };
}

const TYPE_ORDER: CardType[] = ['basic', 'reverse', 'cloze', 'typed', 'listening', 'rule', 'fix', 'reorder', 'translate'];

export function shuffled<T>(items: T[], rng: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Cards that can be studied in this scope: not deleted, not suspended, note and deck exist. */
export function cardsInScope(input: Pick<QueueInput, 'cards' | 'notes' | 'decks'>, scope: Scope): Card[] {
  const notes = new Map(input.notes.filter((n) => n.deletedAt == null).map((n) => [n.id, n]));
  const decks = new Map(input.decks.filter((d) => d.deletedAt == null).map((d) => [d.id, d]));
  const tag = scope.tag?.toLowerCase();
  return input.cards.filter((c) => {
    if (c.deletedAt != null || c.suspended) return false;
    const note = notes.get(c.noteId);
    const deck = decks.get(c.deckId);
    if (!note || !deck) return false;
    if (scope.deckId && c.deckId !== scope.deckId) return false;
    if (scope.category && (deck.category ?? 'vocab') !== scope.category) return false;
    if (tag && !note.tags.some((t) => t.toLowerCase() === tag)) return false;
    return true;
  });
}

/** Take turns across decks so every deck gets a share of today's new cards. */
function roundRobin<T>(groups: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) for (const g of groups) if (i < g.length) out.push(g[i]);
  return out;
}

export function buildQueue(input: QueueInput, opts: QueueOptions): Queue {
  const { settings, now } = input;
  const rng = input.rng ?? Math.random;
  const pool = cardsInScope(input, opts);
  const noteById = new Map(input.notes.map((n) => [n.id, n]));
  const byAdded = (a: Card, b: Card) =>
    (noteById.get(a.noteId)?.createdAt ?? 0) - (noteById.get(b.noteId)?.createdAt ?? 0) ||
    TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);

  if (opts.mode === 'cram' && opts.cardIds) {
    const usable = new Set(cardsInScope(input, {}).map((c) => c.id));
    const ids = opts.cardIds.filter((id) => usable.has(id));
    const main = opts.shuffle ? shuffled(ids, rng) : ids;
    return { learning: [], main, counts: { learning: 0, review: 0, new: main.length } };
  }
  if (opts.mode === 'cram') {
    const all = opts.shuffle ? shuffled(pool, rng) : [...pool].sort(byAdded);
    return { learning: [], main: all.map((c) => c.id), counts: { learning: 0, review: 0, new: all.length } };
  }

  const dayEnd = studyDayEnd(now, settings.dayStartHour);
  const real = input.logsToday.filter((l) => l.deletedAt == null && !l.cram);
  const newDone = new Set(real.filter((l) => l.state === CardState.New).map((l) => l.cardId)).size;
  const reviewsDone = real.filter((l) => l.state === CardState.Review).length;
  const notesSeenToday = new Set(real.map((l) => l.noteId));

  const learning = pool
    .filter((c) => (c.state === CardState.Learning || c.state === CardState.Relearning) && c.due < dayEnd)
    .sort((a, b) => a.due - b.due);

  let reviews = pool.filter((c) => c.state === CardState.Review && c.due < dayEnd).sort((a, b) => a.due - b.due);
  if (opts.shuffle || settings.reviewOrder === 'random') reviews = shuffled(reviews, rng);
  reviews = reviews.slice(0, Math.max(0, settings.reviewsPerDay - reviewsDone));

  // New cards: one sibling per word per day, so "hund → dog" and "dog → hund"
  // are not introduced back to back.
  const busy = new Set<ID>([...notesSeenToday, ...learning.map((c) => c.noteId), ...reviews.map((c) => c.noteId)]);
  const firstNew: Card[] = [];
  for (const c of pool.filter((x) => x.state === CardState.New).sort(byAdded)) {
    if (busy.has(c.noteId)) continue;
    busy.add(c.noteId);
    firstNew.push(c);
  }
  let fresh: Card[];
  if (opts.shuffle || settings.newOrder === 'random') fresh = shuffled(firstNew, rng);
  else {
    const deckOrder = input.decks.map((d) => d.id);
    const groups = new Map<ID, Card[]>();
    for (const c of firstNew) groups.set(c.deckId, [...(groups.get(c.deckId) ?? []), c]);
    fresh = roundRobin([...groups.entries()].sort((a, b) => deckOrder.indexOf(a[0]) - deckOrder.indexOf(b[0])).map(([, g]) => g));
  }
  fresh = fresh.slice(0, Math.max(0, settings.newPerDay - newDone) + (opts.extraNew ?? 0));

  const main = opts.shuffle ? shuffled([...reviews, ...fresh], rng) : [...reviews, ...fresh];
  return {
    learning: learning.map((c) => c.id),
    main: main.map((c) => c.id),
    counts: { learning: learning.length, review: reviews.length, new: fresh.length },
  };
}

// ---------- stepping through a session ----------

export interface SessionState {
  mode: 'normal' | 'cram';
  learning: ID[];
  main: ID[];
  current: ID | null;
  done: number;
  again: number;
}

/**
 * Choose the next card: a learning card whose timer is up, else the next
 * review/new card, else the learning card that is due soonest (rather than
 * making me wait).
 */
export function pickNext(s: Omit<SessionState, 'current'>, dueOf: (id: ID) => number, now: number): SessionState {
  const learning = [...s.learning].sort((a, b) => dueOf(a) - dueOf(b));
  const ready = learning.find((id) => dueOf(id) <= now);
  if (ready) return { ...s, learning: learning.filter((id) => id !== ready), current: ready };
  if (s.main.length) return { ...s, learning, main: s.main.slice(1), current: s.main[0] };
  if (learning.length) return { ...s, learning: learning.slice(1), current: learning[0] };
  return { ...s, learning, current: null };
}

export function startSession(queue: Queue, mode: 'normal' | 'cram', dueOf: (id: ID) => number, now: number): SessionState {
  return pickNext({ mode, learning: queue.learning, main: queue.main, done: 0, again: 0 }, dueOf, now);
}

/** How far back a failed card goes in cram mode. */
export const CRAM_REINSERT = 4;

/**
 * Advance after the current card was rated.
 * `comesBack`: in normal mode, true if the card is still in learning steps
 * today; in cram mode, true if it was failed and should be shown again.
 */
export function advance(s: SessionState, comesBack: boolean, failed: boolean, dueOf: (id: ID) => number, now: number): SessionState {
  if (!s.current) return s;
  let { learning, main } = s;
  if (comesBack) {
    if (s.mode === 'cram') {
      const at = Math.min(main.length, CRAM_REINSERT);
      main = [...main.slice(0, at), s.current, ...main.slice(at)];
    } else learning = [...learning, s.current];
  }
  return pickNext({ mode: s.mode, learning, main, done: s.done + 1, again: s.again + (failed ? 1 : 0) }, dueOf, now);
}

/** Drop the current card (suspended or deleted mid-session) and move on. */
export function dropCurrent(s: SessionState, dueOf: (id: ID) => number, now: number): SessionState {
  return pickNext({ mode: s.mode, learning: s.learning, main: s.main, done: s.done, again: s.again }, dueOf, now);
}

export const remaining = (s: SessionState) => s.learning.length + s.main.length + (s.current ? 1 : 0);
