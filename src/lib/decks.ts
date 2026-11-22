// The Decks page: decks grouped by plan week and lesson (from the Week Map),
// the current lesson pinned on top, and what each deck row shows.

import { CardState, type Card, type Deck, type ID, type ReviewLog, type Settings } from '../db/types';
import { countToday } from '../db/repo';
import { lessonsOfWeek, weekForLesson } from './plan';

/** The lesson a deck belongs to: its lesson number, or the "Lesson 02" in its name (the starter decks carry it only there). */
export function deckLesson(deck: Pick<Deck, 'lessonNumber' | 'name'>): number | null {
  if (deck.lessonNumber != null) return deck.lessonNumber;
  const m = /\bLesson\s+(\d+)\b/i.exec(deck.name);
  return m ? Number(m[1]) : null;
}

export interface DeckGroup {
  key: string;
  title: string;
  /** null for decks that belong to no lesson. */
  week: number | null;
  decks: Deck[];
  /** The week of my current lesson: open by default. Older weeks start collapsed. */
  current: boolean;
}

export function weekTitle(week: number): string {
  const lessons = lessonsOfWeek(week);
  if (week <= 0) return 'Week 0 · before the plan (Lessons 1 to 5)';
  return `Week ${week} · Lesson${lessons.length === 1 ? '' : 's'} ${lessons[0]}${lessons.length > 1 ? ` to ${lessons[lessons.length - 1]}` : ''}`;
}

/**
 * Decks for the page: the current lesson's decks pinned, then one group per
 * plan week (newest first), then the decks without a lesson. `query` filters
 * by name.
 */
export function groupDecks(decks: Deck[], currentLesson: number, query = ''): { pinned: Deck[]; groups: DeckGroup[] } {
  const q = query.trim().toLowerCase();
  const shown = decks.filter((d) => d.deletedAt == null && (!q || d.name.toLowerCase().includes(q)));
  const byName = (a: Deck, b: Deck) => (deckLesson(a) ?? 0) - (deckLesson(b) ?? 0) || a.name.localeCompare(b.name, 'sv', { numeric: true });
  const pinned = shown.filter((d) => deckLesson(d) === currentLesson && currentLesson > 0).sort(byName);
  const rest = shown.filter((d) => !pinned.includes(d));
  const weeks = new Map<number, Deck[]>();
  const loose: Deck[] = [];
  for (const d of rest) {
    const lesson = deckLesson(d);
    if (lesson == null) loose.push(d);
    else weeks.set(weekForLesson(lesson), [...(weeks.get(weekForLesson(lesson)) ?? []), d]);
  }
  const currentWeek = weekForLesson(currentLesson);
  const groups: DeckGroup[] = [...weeks.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([week, list]) => ({ key: `week-${week}`, title: weekTitle(week), week, decks: list.sort(byName), current: week === currentWeek }));
  if (loose.length) groups.push({ key: 'no-lesson', title: 'Other decks (no lesson)', week: null, decks: loose.sort(byName), current: false });
  return { pinned, groups };
}

export interface DeckRowCounts {
  /** Cards due today in this deck (learning steps and reviews, within the daily limit). */
  due: number;
  /** New cards this deck would hand out today, after the daily cap. */
  newToday: number;
  /** Cards never studied and in rotation: the deck's own count, whatever the daily cap. */
  unstarted: number;
  total: number;
}

export function deckRowCounts(deckId: ID, cards: Card[], logsToday: ReviewLog[], settings: Settings, now: number): DeckRowCounts {
  const mine = cards.filter((c) => c.deckId === deckId && c.deletedAt == null);
  const c = countToday(mine, logsToday, settings, now);
  return { due: c.dueToday, newToday: c.newToday, unstarted: mine.filter((x) => !x.suspended && x.state === CardState.New).length, total: mine.length };
}
