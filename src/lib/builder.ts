// Sentence builder: an English sentence on screen, the Swedish typed from
// memory. Every sentence is one of mine: a translate card, a reorder card
// (its English hint and its answer), an example or phrase pair from a word
// card, or a line from a text. Nothing is generated.

import { CardState, type Card, type ID, type Note } from '../db/types';
import { canon } from './check';
import { splitAlternatives, splitHint } from './parser';
import { lessonNumberOf, lessonsOfWeek } from './plan';
import { sentencePool } from './practice';
import type { ReadingText } from './texts';

export const BUILDER_DECK = 'Sentence builder';
export const BUILDER_DECK_ID = 'builder:deck';
/** Share of a session taken from the current plan week. */
export const CURRENT_SHARE = 0.7;

export interface BuilderItem {
  /** Identity of the sentence: the canonical Swedish. */
  key: string;
  en: string;
  /** The Swedish; may hold accepted alternatives separated by " // ". */
  sv: string;
  explanation: string;
  lesson: number | null;
  source: 'translate' | 'reorder' | 'example' | 'text';
  /** The translate note that is rated for this sentence. For the other sources it is created on the first answer. */
  noteId: ID;
  /** True when that note already exists. */
  hasNote: boolean;
  tags: string[];
}

const keyOf = (sv: string) => canon(splitAlternatives(sv)[0] ?? sv).toLowerCase();

/** FNV-1a, as hex: a short stable name for a sentence. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of new TextEncoder().encode(s)) {
    h ^= ch;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The id of the translate note a sentence gets: the same on every device, so it is never doubled. */
export const builderNoteId = (sv: string): ID => `builder:${hash(keyOf(sv))}:${keyOf(sv).length}`;

export interface PoolInput {
  notes: Note[];
  texts: ReadingText[];
  /** Notes with no card in rotation (locked or suspended). */
  resting?: Set<ID>;
}

/** Every sentence pair I have, once each. A translate card wins over the same sentence from another source. */
export function builderPool({ notes, texts, resting = new Set() }: PoolInput): BuilderItem[] {
  const seen = new Map<string, BuilderItem>();
  const add = (item: Omit<BuilderItem, 'key' | 'noteId' | 'hasNote'> & { noteId?: ID }) => {
    const key = keyOf(item.sv);
    if (!key || !item.en.trim() || !/\S\s+\S/.test(key) || seen.has(key)) return;
    seen.set(key, { ...item, key, noteId: item.noteId ?? builderNoteId(item.sv), hasNote: item.noteId != null });
  };
  const live = notes.filter((n) => n.deletedAt == null && !resting.has(n.id));

  for (const n of live)
    if (n.kind === 'translate' && n.grammar)
      add({ en: splitHint(n.grammar.prompt).text, sv: n.grammar.answer, explanation: n.grammar.explanation, lesson: lessonNumberOf(n), source: 'translate', noteId: n.id, tags: n.tags });
  for (const n of live) {
    if (n.kind !== 'reorder' || !n.grammar) continue;
    const en = splitHint(n.grammar.prompt).hint;
    if (en) add({ en, sv: n.grammar.answer, explanation: n.grammar.explanation, lesson: lessonNumberOf(n), source: 'reorder', tags: n.tags });
  }
  const vocab = new Map(live.filter((n) => n.kind === 'vocab').map((n) => [n.id, n]));
  for (const s of sentencePool(live)) {
    const n = vocab.get(s.noteId);
    if (n && s.en) add({ en: s.en, sv: s.sv, explanation: '', lesson: lessonNumberOf(n), source: 'example', tags: n.tags });
  }
  for (const t of texts) for (const l of t.lines) if (l.sv && l.en) add({ en: l.en, sv: l.sv, explanation: '', lesson: t.lesson, source: 'text', tags: [] });
  return [...seen.values()];
}

export interface PickOptions {
  size: number;
  currentWeek: number;
  currentLesson: number;
  /** The translate cards behind the pool, by note id. */
  cards: Map<ID, Pick<Card, 'state' | 'due' | 'suspended'>>;
  now: number;
  rng?: () => number;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** "Current week": a lesson of my current plan week that I have reached. Everything else is older. */
export function isCurrent(item: Pick<BuilderItem, 'lesson'>, currentWeek: number, currentLesson: number): boolean {
  return item.lesson != null && item.lesson <= currentLesson && lessonsOfWeek(currentWeek).includes(item.lesson);
}

/**
 * A session: 70% from the current week, the rest from older lessons; when one
 * side runs short the other fills in. Inside each side, due cards come first,
 * then sentences never practised, then the rest in random order.
 */
export function pickSession(pool: BuilderItem[], opts: PickOptions): BuilderItem[] {
  const rng = opts.rng ?? Math.random;
  const tier = (i: BuilderItem) => {
    const card = opts.cards.get(i.noteId);
    if (!card || card.state === CardState.New) return 1;
    return card.due <= opts.now ? 0 : 2;
  };
  const order = (items: BuilderItem[]) => [0, 1, 2].flatMap((t) => shuffle(items.filter((i) => tier(i) === t), rng));
  const usable = pool.filter((i) => !opts.cards.get(i.noteId)?.suspended);
  const current = order(usable.filter((i) => isCurrent(i, opts.currentWeek, opts.currentLesson)));
  const older = order(usable.filter((i) => !isCurrent(i, opts.currentWeek, opts.currentLesson)));

  const size = Math.max(1, Math.round(opts.size));
  let fromCurrent = Math.min(current.length, Math.round(CURRENT_SHARE * size));
  let fromOlder = Math.min(older.length, size - fromCurrent);
  fromCurrent = Math.min(current.length, size - fromOlder);
  fromOlder = Math.min(older.length, size - fromCurrent);
  return shuffle([...current.slice(0, fromCurrent), ...older.slice(0, fromOlder)], rng);
}

/** The rating a checked sentence gets: Good, Hard or Again. */
export const builderGrade = (verdict: 'correct' | 'close' | 'wrong'): 1 | 2 | 3 => (verdict === 'correct' ? 3 : verdict === 'close' ? 2 : 1);
