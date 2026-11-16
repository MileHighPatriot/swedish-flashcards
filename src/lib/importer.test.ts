import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../seed/grammar-lessons-01-02.txt?raw', () => ({ default: '' }));
vi.mock('../../seed/lessons-01-02-extras.txt?raw', () => ({ default: '' }));

import { db } from '../db/db';
import { listCards, listDecks, listNotes, unlockDeck } from '../db/repo';
import { applyPlan, buildPlan, groupLesson, loadStarterLessons } from './importer';
import { parseLesson } from './parser';

const seed = (f: string) => readFileSync(new URL(`../../seed/${f}`, import.meta.url), 'utf8');
const MAIN = seed('grammar-lessons-01-02.txt');
const EXTRAS = seed('lessons-01-02-extras.txt');

async function deckCounts() {
  const decks = await listDecks();
  const notes = await listNotes();
  const cards = await listCards();
  return Object.fromEntries(
    decks.map((d) => [
      d.name,
      { notes: notes.filter((n) => n.deckId === d.id).length, cards: cards.filter((c) => c.deckId === d.id).length },
    ]),
  );
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('starter lessons loader', () => {
  it('creates the five decks from my lesson file with the expected counts', async () => {
    const r = await loadStarterLessons([MAIN]);
    expect(r.errors).toEqual([]);
    expect(r.added).toBe(88);
    expect(await deckCounts()).toEqual({
      'Coming soon – irregular & modal verbs': { notes: 18, cards: 36 },
      'Conversation phrases': { notes: 8, cards: 16 },
      'Grammar – My mistakes': { notes: 20, cards: 20 },
      'Grammar – Past tense & word order': { notes: 29, cards: 29 },
      'Time words & phrases': { notes: 13, cards: 26 },
    });
  });

  it('files each deck under the right section', async () => {
    await loadStarterLessons([MAIN, EXTRAS]);
    const cat = Object.fromEntries((await listDecks()).map((d) => [d.name, d.category]));
    expect(cat['Grammar – My mistakes']).toBe('grammar');
    expect(cat['Grammar – Past tense & word order']).toBe('grammar');
    expect(cat['Conversation phrases']).toBe('phrases');
    expect(cat['Time words & phrases']).toBe('phrases');
    expect(cat['Lesson 01 – -ade verbs']).toBe('vocab');
    expect(cat['Coming soon – irregular & modal verbs']).toBe('vocab');
  });

  it('adds the extras from the printables', async () => {
    const r = await loadStarterLessons([MAIN, EXTRAS]);
    expect(r.errors).toEqual([]);
    expect(await deckCounts()).toEqual({
      'Coming soon – irregular & modal verbs': { notes: 18, cards: 36 },
      'Conversation phrases': { notes: 16, cards: 32 },
      'Grammar – My mistakes': { notes: 21, cards: 21 },
      'Grammar – Past tense & word order': { notes: 48, cards: 48 },
      'Lesson 01 – -ade verbs': { notes: 20, cards: 40 },
      'Lesson 02 – -te and -de verbs': { notes: 20, cards: 40 },
      'Spelling watch-list': { notes: 6, cards: 12 },
      'Time words & phrases': { notes: 15, cards: 30 },
    });
  });

  it('keeps the grammar card types and the // alternatives', async () => {
    await loadStarterLessons([MAIN]);
    const notes = await listNotes();
    const byKind = (k: string) => notes.filter((n) => n.kind === k).length;
    expect([byKind('rule'), byKind('fix'), byKind('reorder'), byKind('translate'), byKind('vocab')]).toEqual([17, 20, 6, 6, 39]);
    const t = notes.find((n) => n.grammar?.prompt === 'Yesterday I worked at the store.')!;
    expect(t.grammar!.answer).toBe('Igår arbetade jag i butiken. // Jag arbetade i butiken igår.');
    expect(t.cardTypes).toEqual(['translate']);
  });

  it('creates the Coming soon deck locked and suspended; unlocking makes its cards new', async () => {
    await loadStarterLessons([MAIN]);
    const deck = (await listDecks()).find((d) => d.name.startsWith('Coming soon'))!;
    expect(deck.locked).toBe(true);
    let cards = await listCards(deck.id);
    expect(cards.every((c) => c.suspended && c.state === 0)).toBe(true);
    const others = (await listCards()).filter((c) => c.deckId !== deck.id);
    expect(others.some((c) => c.suspended)).toBe(false);

    await unlockDeck(deck.id);
    cards = await listCards(deck.id);
    expect(cards.every((c) => !c.suspended && c.state === 0)).toBe(true);
    expect((await listDecks()).find((d) => d.id === deck.id)!.locked).toBe(false);
  });

  it('is safe to run twice', async () => {
    await loadStarterLessons([MAIN, EXTRAS]);
    const before = await deckCounts();
    const again = await loadStarterLessons([MAIN, EXTRAS]);
    expect(again.added).toBe(0);
    expect(again.merged).toBe(0);
    expect(await deckCounts()).toEqual(before);
  });

  it('gives spelling words a typed card', async () => {
    await loadStarterLessons([EXTRAS]);
    const n = (await listNotes()).find((x) => x.swedish === 'musik')!;
    expect(n.cardTypes).toEqual(['basic', 'typed']);
  });
});

describe('pasted lessons', () => {
  const opts = { lessonNumber: 3, lessonName: 'Irregular verbs', extraTags: ['lesson-03'], cardTypes: ['basic', 'reverse'] as const };
  const text = [
    '### Vocab',
    'gå | go, walk | går, gick | Jag gick hem. = I went home. | irregular',
    'se | see | ser, såg',
    '### Phrases',
    'Vad bra! | How nice!',
    '### Grammar rules',
    'rule | What is the past of gå? | gick | Irregular. | irregular',
    '### Fix the error',
    'fix | Jag gåt hem. | Jag gick hem. | Irregular past. | my-mistake',
  ].join('\n');

  it('sorts sections into vocabulary, phrases and grammar decks named by lesson', async () => {
    const groups = groupLesson(parseLesson(text), 3, 'Irregular verbs');
    expect(groups.map((g) => [g.deck.name, g.deck.category, g.items.length])).toEqual([
      ['Lesson 03 – Irregular verbs', 'vocab', 2],
      ['Phrases – Lesson 03 – Irregular verbs', 'phrases', 1],
      ['Grammar – Lesson 03 – Irregular verbs', 'grammar', 1],
      ['Grammar – My mistakes', 'grammar', 1],
    ]);
    const r = await applyPlan(await buildPlan(groups), { ...opts, cardTypes: [...opts.cardTypes] });
    expect(r.added).toBe(5);
    const notes = await listNotes();
    expect(notes.every((n) => n.tags.includes('lesson-03') && n.lessonNumber === 3)).toBe(true);
  });

  it('detects duplicates: merge updates the card in place, skip leaves it alone', async () => {
    const run = async (t: string, action?: 'skip') => {
      const plan = await buildPlan(groupLesson(parseLesson(t), 3, 'Irregular verbs'));
      if (action) plan.forEach((g) => g.rows.forEach((r) => r.duplicate && (r.action = action)));
      return { plan, result: await applyPlan(plan, { ...opts, cardTypes: [...opts.cardTypes] }) };
    };
    await run('gå | go | går, gick');
    const first = (await listNotes())[0];

    const merged = await run('gå | go, walk | | Jag gick hem. = I went home. | irregular');
    expect(merged.plan[0].rows[0].duplicate?.sameDeck).toBe(true);
    expect(merged.plan[0].rows[0].action).toBe('merge');
    expect(merged.result).toMatchObject({ added: 0, merged: 1 });
    let notes = await listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(first.id);
    expect(notes[0].english).toBe('go, walk');
    expect(notes[0].verb?.past).toBe('gick'); // not blanked by the empty forms field
    expect(notes[0].exampleSv).toBe('Jag gick hem.');
    expect(notes[0].tags).toEqual(['lesson-03', 'irregular']);
    expect(await listCards()).toHaveLength(2); // scheduling untouched, no new siblings

    const skipped = await run('gå | CHANGED', 'skip');
    expect(skipped.result).toMatchObject({ added: 0, merged: 0, skipped: 1 });
    notes = await listNotes();
    expect(notes[0].english).toBe('go, walk');
  });

  it('flags a word that already lives in another deck and a repeat inside the same paste', async () => {
    await applyPlan(await buildPlan(groupLesson(parseLesson('gå | go'), 1, 'One')), { ...opts, cardTypes: [...opts.cardTypes] });
    const plan = await buildPlan(groupLesson(parseLesson('gå | go\nse | see\nse | see again'), 2, 'Two'));
    const [ga, se1, se2] = plan[0].rows;
    expect(ga.duplicate).toMatchObject({ sameDeck: false, deckName: 'Lesson 01 – One' });
    expect(ga.action).toBe('skip');
    expect(se1.duplicate).toBeNull();
    expect(se2.action).toBe('skip');
  });
});
