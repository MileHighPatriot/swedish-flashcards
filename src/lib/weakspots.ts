// Weak-spot analysis: which cards and tags I keep failing, a study set built
// from them, and the markdown summary for pasting into a lesson chat.

import type { Card, ID, Mistake, Note, ReviewLog } from '../db/types';
import { DAY_MS } from './scheduler';

export interface WeakTag {
  tag: string;
  fails: number;
}

export interface WeakCard {
  cardId: ID;
  noteId: ID;
  /** What the card asks. */
  prompt: string;
  correct: string;
  fails: number;
  /** What I typed on failed attempts, newest first, without repeats. */
  typed: string[];
  tags: string[];
}

export interface WeakStats {
  tags: WeakTag[];
  cards: WeakCard[];
  /** Reviews in the last 7 days, cram included. */
  reviewsThisWeek: number;
  failsThisWeek: number;
  totalFails: number;
}

export interface WeakInput {
  reviews: ReviewLog[];
  mistakes: Mistake[];
  notes: Note[];
  cards: Card[];
  now: number;
}

/** Tags that describe where a card came from, not what is hard about it. */
const isNoiseTag = (t: string) => /^lesson-\d+$/i.test(t) || t.toLowerCase() === 'my-mistake';

function promptOf(note: Note, card: Card | undefined): { prompt: string; correct: string } {
  if (note.grammar) return { prompt: note.grammar.prompt, correct: note.grammar.answer };
  const sv = `${note.noun?.gender ? `${note.noun.gender} ` : ''}${note.swedish}`;
  return card?.type === 'basic' || card?.type === 'listening' ? { prompt: sv, correct: note.english } : { prompt: note.english, correct: sv };
}

export function computeWeakSpots({ reviews, mistakes, notes, cards, now }: WeakInput): WeakStats {
  const noteById = new Map(notes.filter((n) => n.deletedAt == null).map((n) => [n.id, n]));
  const cardById = new Map(cards.filter((c) => c.deletedAt == null).map((c) => [c.id, c]));
  const liveReviews = reviews.filter((r) => r.deletedAt == null);
  const liveMistakes = mistakes.filter((m) => m.deletedAt == null).sort((a, b) => b.at - a.at);

  const tagFails = new Map<string, number>();
  const bump = (tags: string[]) => {
    for (const t of tags) if (!isNoiseTag(t)) tagFails.set(t, (tagFails.get(t) ?? 0) + 1);
  };

  const cardFails = new Map<ID, number>();
  let totalFails = 0;
  for (const r of liveReviews) {
    if (r.rating !== 1) continue;
    totalFails++;
    const note = noteById.get(r.noteId);
    if (!note || !cardById.has(r.cardId)) continue;
    cardFails.set(r.cardId, (cardFails.get(r.cardId) ?? 0) + 1);
    bump(note.tags);
  }
  // Misses that are not card reviews (added by hand, or from the verb drill) still count for their tags.
  for (const m of liveMistakes) if (!m.cardId) bump(m.tags);

  const typedByCard = new Map<ID, string[]>();
  for (const m of liveMistakes) {
    if (!m.cardId || !m.typed.trim()) continue;
    const list = typedByCard.get(m.cardId) ?? [];
    if (!list.includes(m.typed.trim())) list.push(m.typed.trim());
    typedByCard.set(m.cardId, list);
  }

  const weakCards: WeakCard[] = [...cardFails.entries()]
    .map(([cardId, fails]) => {
      const card = cardById.get(cardId)!;
      const note = noteById.get(card.noteId)!;
      return { cardId, noteId: note.id, ...promptOf(note, card), fails, typed: typedByCard.get(cardId) ?? [], tags: note.tags };
    })
    .sort((a, b) => b.fails - a.fails || a.prompt.localeCompare(b.prompt, 'sv'));

  const weekAgo = now - 7 * DAY_MS;
  const week = liveReviews.filter((r) => r.reviewedAt >= weekAgo);
  return {
    tags: [...tagFails.entries()].map(([tag, fails]) => ({ tag, fails })).sort((a, b) => b.fails - a.fails || a.tag.localeCompare(b.tag)),
    cards: weakCards,
    reviewsThisWeek: week.length,
    failsThisWeek: week.filter((r) => r.rating === 1).length,
    totalFails,
  };
}

/**
 * The cards for a "weak spots" session: my most-failed cards, then cards
 * carrying my weakest tags, then my-mistake cards, without repeats.
 */
export function weakSpotCardIds(stats: WeakStats, cards: Card[], notes: Note[], limit = 30): ID[] {
  const noteById = new Map(notes.filter((n) => n.deletedAt == null).map((n) => [n.id, n]));
  const usable = cards.filter((c) => c.deletedAt == null && !c.suspended && noteById.has(c.noteId));
  const usableIds = new Set(usable.map((c) => c.id));
  const out: ID[] = [];
  const push = (id: ID) => {
    if (out.length < limit && usableIds.has(id) && !out.includes(id)) out.push(id);
  };
  const hasTag = (c: Card, tags: string[]) => noteById.get(c.noteId)!.tags.some((t) => tags.includes(t.toLowerCase()));

  stats.cards.slice(0, 15).forEach((c) => push(c.cardId));
  const topTags = stats.tags.slice(0, 3).map((t) => t.tag.toLowerCase());
  if (topTags.length) usable.filter((c) => hasTag(c, topTags)).forEach((c) => push(c.id));
  usable.filter((c) => hasTag(c, ['my-mistake'])).forEach((c) => push(c.id));
  // Nothing failed yet and no mistake cards: fall back to the spelling watch-list.
  if (out.length === 0) usable.filter((c) => hasTag(c, ['watch-spelling'])).forEach((c) => push(c.id));
  return out;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const isoDate = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Markdown summary to paste into the lesson chat. */
export function exportForClaude(stats: WeakStats, now: number): string {
  const lines: string[] = [];
  lines.push(`# Swedish flashcards: my weak spots (${isoDate(now)})`, '');
  lines.push(`- Reviews in the last 7 days: **${stats.reviewsThisWeek}**`);
  lines.push(`- Marked "Again" in the last 7 days: **${stats.failsThisWeek}**`);
  lines.push(`- Misses recorded in total: **${stats.totalFails}**`, '');

  lines.push('## Top weak tags', '');
  if (stats.tags.length === 0) lines.push('No misses recorded yet.');
  stats.tags.slice(0, 10).forEach((t, i) => lines.push(`${i + 1}. \`${t.tag}\`: ${t.fails} miss${t.fails === 1 ? '' : 'es'}`));
  lines.push('');

  lines.push('## Most-failed cards', '');
  if (stats.cards.length === 0) lines.push('No failed cards yet.');
  stats.cards.slice(0, 15).forEach((c, i) => {
    lines.push(`${i + 1}. **${oneLine(c.prompt)}** → ${oneLine(c.correct)}`);
    lines.push(`   - Failed ${c.fails} time${c.fails === 1 ? '' : 's'}`);
    if (c.typed.length) lines.push(`   - I typed: ${c.typed.slice(0, 3).map((t) => `"${oneLine(t)}"`).join('; ')}`);
    const tags = c.tags.filter((t) => !/^lesson-\d+$/i.test(t));
    if (tags.length) lines.push(`   - Tags: ${tags.join(', ')}`);
  });
  lines.push('');
  lines.push('Please build my next lesson and review around these weak spots.', '');
  return lines.join('\n');
}
