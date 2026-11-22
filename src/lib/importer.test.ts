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
    expect(t.grammar!.answer).toBe('I går arbetade jag i butiken. // Jag arbetade i butiken i går.');
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

describe('reorder cards carry their English meaning', () => {
  it('every built-in reorder card has one, and the words exclude it', async () => {
    const { splitChunks, splitHint } = await import('./parser');
    await loadStarterLessons([MAIN, EXTRAS]);
    const reorder = (await listNotes()).filter((n) => n.kind === 'reorder');
    expect(reorder).toHaveLength(10);
    for (const n of reorder) {
      const { hint } = splitHint(n.grammar!.prompt);
      expect(hint, n.grammar!.prompt).toMatch(/^[A-Z].*[.?]$/);
      expect(splitChunks(n.grammar!.prompt).join(' ')).not.toMatch(/[()]/);
    }
    const q = reorder.find((n) => n.grammar!.answer === 'Läste du boken?')!;
    expect(splitHint(q.grammar!.prompt).hint).toBe('Did you read the book?');
    expect(splitChunks(q.grammar!.prompt)).toEqual(['du', 'boken', 'läste']);
  });

  it('existing devices get the English added without duplicates or lost edits', async () => {
    const { refreshStarterCards } = await import('./importer');
    const strip = (t: string) => t.replace(/^(reorder \|[^|]*?) \([^)]*\) \|/gm, '$1 |');
    await loadStarterLessons([strip(MAIN), strip(EXTRAS)]); // a device seeded before the change
    const before = await listNotes();
    const mine = before.find((n) => n.kind === 'reorder' && n.grammar!.answer === 'Vad köpte du?')!;
    expect(mine.grammar!.prompt).toBe('köpte / vad / du');
    const edited = before.find((n) => n.kind === 'reorder' && n.grammar!.answer === 'Var bodde du?')!;
    const { updateNote } = await import('../db/repo');
    await updateNote(edited.id, { grammar: { ...edited.grammar!, prompt: 'bodde / var / du (my own wording)' } });

    expect(await refreshStarterCards([MAIN, EXTRAS])).toBe(9);
    const after = await listNotes();
    expect(after).toHaveLength(before.length);
    expect(after.find((n) => n.id === mine.id)!.grammar!.prompt).toBe('köpte / vad / du (What did you buy?)');
    expect(after.find((n) => n.id === edited.id)!.grammar!.prompt).toBe('bodde / var / du (my own wording)');
    expect(await refreshStarterCards([MAIN, EXTRAS])).toBe(0); // settles
    expect((await loadStarterLessons([MAIN, EXTRAS])).added).toBe(0); // and the loader still sees them as the same cards
  });
});

describe('built-in Lesson 3', () => {
  const load = async () => {
    const { loadBuiltInLesson, toBuiltInLesson } = await import('./importer');
    return loadBuiltInLesson(toBuiltInLesson('lesson-03-irregular-verbs.txt', seed('lesson-03-irregular-verbs.txt')));
  };
  const COMING = 'Coming soon – irregular & modal verbs';

  it('is picked up from seed/ with its number and name', async () => {
    const { BUILT_IN_LESSONS } = await import('./importer');
    expect(BUILT_IN_LESSONS.map((l) => [l.key, l.number, l.name])).toContainEqual(['lesson-03-irregular-verbs.txt', 3, 'Irregular verbs']);
  });

  it('lands in its own decks, on top of lessons 1 and 2, with nothing doubled', async () => {
    await loadStarterLessons([MAIN, EXTRAS]);
    const before = await deckCounts();
    const r = await load();
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ added: 89, moved: 9, merged: 5 });

    const counts = await deckCounts();
    expect(counts['Lesson 03 – Irregular verbs']).toEqual({ notes: 28, cards: 56 });
    expect(counts['Phrases – Lesson 03 – Irregular verbs']).toEqual({ notes: 13, cards: 26 });
    expect(counts['Grammar – Lesson 03 – Irregular verbs']).toEqual({ notes: 35, cards: 35 });
    expect(counts['Grammar – My mistakes'].notes).toBe(before['Grammar – My mistakes'].notes + 22);
    // The nine verbs that were waiting in the locked deck moved out of it.
    expect(counts[COMING].notes).toBe(before[COMING].notes - 9);
    expect(counts['Grammar – Past tense & word order']).toEqual(before['Grammar – Past tense & word order']);

    const notes = await listNotes();
    const cards = await listCards();
    const lesson = (await listDecks()).find((d) => d.name === 'Lesson 03 – Irregular verbs')!;
    const inLesson = notes.filter((n) => n.deckId === lesson.id);
    expect(inLesson.every((n) => n.tags.includes('lesson-03'))).toBe(true);
    expect(cards.filter((c) => c.deckId === lesson.id).every((c) => !c.suspended)).toBe(true);

    const fa = notes.filter((n) => n.kind === 'vocab' && n.swedish === 'få');
    expect(fa).toHaveLength(1);
    expect(fa[0]).toMatchObject({ deckId: lesson.id, english: 'get, receive', exampleSv: 'Jag fick en present.' });
    expect(fa[0].verb).toEqual({ infinitive: 'få', present: 'får', past: 'fick', supine: 'fått' });

    // Same prompt as a Lesson 2 card: one card, now with the Lesson 3 wording and tags.
    const did = notes.filter((n) => n.kind === 'translate' && n.grammar!.prompt === 'What did you do yesterday?');
    expect(did).toHaveLength(1);
    expect(did[0].grammar!.explanation).toBe('göra is gjorde; verb second after the question word.');
    expect(did[0].tags).toEqual(expect.arrayContaining(['irregular', 'questions', 'lesson-03']));
  });

  it('is safe to load twice, and the starter loader does not bring the moved verbs back', async () => {
    await loadStarterLessons([MAIN, EXTRAS]);
    await load();
    const before = await deckCounts();
    expect(await load()).toMatchObject({ added: 0, moved: 0, merged: 0 });
    expect((await loadStarterLessons([MAIN, EXTRAS])).added).toBe(0);
    expect(await deckCounts()).toEqual(before);
  });

  it('keeps review history and my own edits', async () => {
    await loadStarterLessons([MAIN, EXTRAS]);
    const { updateNote } = await import('../db/repo');
    const mine = (await listNotes()).find((n) => n.kind === 'translate' && n.grammar!.prompt === 'We lived in Denver.')!;
    await updateNote(mine.id, { grammar: { ...mine.grammar!, explanation: 'my own note' } });
    const ga = (await listNotes()).find((n) => n.kind === 'vocab' && n.swedish === 'gå')!;
    const gaCards = (await listCards()).filter((c) => c.noteId === ga.id).map((c) => c.id).sort();

    await load();
    const notes = await listNotes();
    expect(notes.find((n) => n.id === mine.id)!.grammar!.explanation).toBe('my own note');
    expect(notes.filter((n) => n.kind === 'translate' && n.grammar!.prompt === 'We lived in Denver.')).toHaveLength(1);
    expect((await listCards()).filter((c) => c.noteId === ga.id).map((c) => c.id).sort()).toEqual(gaCards);
  });
});
