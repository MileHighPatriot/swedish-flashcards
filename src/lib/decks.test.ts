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
