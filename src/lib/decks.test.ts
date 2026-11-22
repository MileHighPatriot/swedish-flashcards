import { describe, expect, it } from 'vitest';
import type { Deck } from '../db/types';
import { deckLesson, groupDecks, weekTitle } from './decks';

const deck = (name: string, lessonNumber: number | null = null, over: Partial<Deck> = {}): Deck => ({ id: name, name, category: 'vocab', lessonNumber, lessonName: '', description: '', locked: false, createdAt: 0, updatedAt: 0, deletedAt: null, ...over });
const mine = [
  deck('Lesson 00 – Starter words', 0),
  deck('Lesson 01 – -ade verbs'),
  deck('Lesson 02 – -te and -de verbs'),
  deck('Lesson 03 – Irregular verbs', 3),
  deck('Grammar – Lesson 03 – Irregular verbs', 3),
  deck('Lesson 05 – Modals, pronouns and review', 5),
  deck('Phrases – Lesson 05 – Modals, pronouns and review', 5),
  deck('Lesson 06 – Negation', 6),
  deck('Grammar – Lesson 06 – Negation', 6),
  deck('Lesson 07 – More negation', 7),
  deck('Lesson 09 – Clauses', 9),
  deck('Grammar – My mistakes'),
  deck('Spelling watch-list'),
  deck('Deleted', 6, { deletedAt: 1 }),
];
const names = (ds: Deck[]) => ds.map((d) => d.name);

describe('decks grouped by plan week and lesson', () => {
  it('reads a deck’s lesson from its number, or from the "Lesson 02" in its name', () => {
    expect(deckLesson(deck('Lesson 02 – -te and -de verbs'))).toBe(2);
    expect(deckLesson(deck('Phrases – Lesson 05 – x', 5))).toBe(5);
    expect(deckLesson(deck('Grammar – My mistakes'))).toBeNull();
  });

  it('pins the current lesson, then weeks newest first, then decks with no lesson', () => {
    const { pinned, groups } = groupDecks(mine, 7);
    expect(names(pinned)).toEqual(['Lesson 07 – More negation']);
    expect(groups.map((g) => [g.title, g.decks.length, g.current])).toEqual([
      ['Week 2 · Lessons 9 to 11', 1, false],
      ['Week 1 · Lessons 6 to 8', 2, true],
      ['Week 0 · before the plan (Lessons 1 to 5)', 7, false],
      ['Other decks (no lesson)', 2, false],
    ]);
    expect(names(groups[1].decks)).toEqual(['Grammar – Lesson 06 – Negation', 'Lesson 06 – Negation']);
    expect(names(groups[2].decks).slice(0, 3)).toEqual(['Lesson 00 – Starter words', 'Lesson 01 – -ade verbs', 'Lesson 02 – -te and -de verbs']);
    // No deck is listed twice, and none is lost.
    const all = [...pinned, ...groups.flatMap((g) => g.decks)];
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(13);
  });

  it('today: lesson 5 is pinned, and week 0 is the open group', () => {
    const { pinned, groups } = groupDecks(mine.filter((d) => (deckLesson(d) ?? 0) <= 5), 5);
    expect(names(pinned)).toEqual(['Lesson 05 – Modals, pronouns and review', 'Phrases – Lesson 05 – Modals, pronouns and review']);
    expect(groups.map((g) => [g.week, g.current])).toEqual([
      [0, true],
      [null, false],
    ]);
  });

  it('searches by name', () => {
    const { pinned, groups } = groupDecks(mine, 7, '  NEGATION ');
    expect(names([...pinned, ...groups.flatMap((g) => g.decks)]).sort()).toEqual(['Grammar – Lesson 06 – Negation', 'Lesson 06 – Negation', 'Lesson 07 – More negation']);
    expect(groupDecks(mine, 7, 'zzz')).toEqual({ pinned: [], groups: [] });
  });

  it('titles weeks from the Week Map', () => {
    expect(weekTitle(4)).toBe('Week 4 · Lessons 15 to 16');
    expect(weekTitle(0)).toBe('Week 0 · before the plan (Lessons 1 to 5)');
  });
});

describe('what a deck row shows', () => {
  it('"new" is the deck’s own count of unstarted cards, whatever the daily cap', async () => {
    const { deckRowCounts } = await import('./decks');
    const { DEFAULT_SETTINGS, CardState } = await import('../db/types');
    const now = new Date(2026, 10, 23, 12).getTime();
    const card = (id: string, deckId: string, state: number, over = {}) =>
      ({ id, noteId: id, deckId, type: 'basic', state, due: now - 1000, suspended: false, leech: false, deletedAt: null, stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, learningSteps: 0, reps: state === CardState.New ? 0 : 2, lapses: 0, lastReview: null, createdAt: 0, updatedAt: 0, ...over }) as never;
    const cards = [
      ...Array.from({ length: 37 }, (_, i) => card(`a${i}`, 'A', CardState.New)),
      card('a-rev', 'A', CardState.Review),
      card('a-susp', 'A', CardState.New, { suspended: true }),
      card('a-gone', 'A', CardState.New, { deletedAt: 5 }),
      ...Array.from({ length: 4 }, (_, i) => card(`b${i}`, 'B', CardState.New)),
      card('b-learn', 'B', CardState.Learning),
    ];
    const settings = { ...DEFAULT_SETTINGS, newPerDay: 10 };
    const a = deckRowCounts('A', cards, [], settings, now);
    // 37 unstarted cards, though today's cap would introduce only 10 of them.
    expect(a).toEqual({ due: 1, newToday: 10, unstarted: 37, total: 39 });
    expect(deckRowCounts('B', cards, [], settings, now)).toEqual({ due: 1, newToday: 4, unstarted: 4, total: 5 });
    expect(deckRowCounts('C', cards, [], settings, now)).toEqual({ due: 0, newToday: 0, unstarted: 0, total: 0 });
    // The cap itself is untouched: with it at 0 the queue hands out nothing, and the label still tells the truth.
    expect(deckRowCounts('A', cards, [], { ...settings, newPerDay: 0 }, now)).toMatchObject({ newToday: 0, unstarted: 37 });
  });
});
