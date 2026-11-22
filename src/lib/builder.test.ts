import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { ensureBuilderCard, listCards, listDecks, listNotes } from '../db/repo';
import { CardState, type Note } from '../db/types';
import { BUILDER_DECK, BUILDER_DECK_ID, builderGrade, builderNoteId, builderPool, isCurrent, pickSession, type BuilderItem } from './builder';
import { parseText } from './texts';

const base = { deckId: 'd', english: '', swedish: '', pos: 'other', exampleSv: '', exampleEn: '', notes: '', lessonName: '', noun: null, verb: null, adjective: null, audioId: null, imageId: null, createdAt: 0, updatedAt: 0, deletedAt: null };
const grammar = (id: string, kind: 'translate' | 'reorder' | 'fix', prompt: string, answer: string, tags: string[]): Note =>
  ({ ...base, id, kind, grammar: { prompt, answer, explanation: 'why', topic: null }, tags, lessonNumber: null, cardTypes: [kind] }) as Note;
const word = (id: string, swedish: string, english: string, exampleSv: string, exampleEn: string, tags: string[]): Note =>
  ({ ...base, id, kind: 'vocab', grammar: null, swedish, english, exampleSv, exampleEn, tags, lessonNumber: null, cardTypes: ['basic'] }) as Note;

/** A seeded generator, so the selection is the same every run. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('the pool', () => {
  const notes = [
    grammar('t1', 'translate', 'Where do you live? (a place)', 'Var bor du?', ['lesson-04']),
    grammar('r1', 'reorder', 'satt / jag / i soffan / sedan (Then I sat on the sofa.)', 'Sedan satt jag i soffan.', ['lesson-04']),
    grammar('r2', 'reorder', 'du / boken / läste', 'Läste du boken?', ['lesson-02']),
    grammar('f1', 'fix', 'Sedan jag lagade middag.', 'Sedan lagade jag middag.', ['lesson-04']),
    word('w1', 'skriva', 'write', 'I går skrev jag en lista.', 'Yesterday I wrote a list.', ['lesson-04']),
    word('w2', 'Vad bra!', 'How nice!', '', '', ['lesson-01']),
    // The same sentence as the translate card: the card wins.
    word('w3', 'bo', 'live', 'Var bor du?', 'Where do you live?', ['lesson-03']),
  ];
  const text = parseText('# Lesson 04 – Min lördag\nI lördags vaknade jag klockan åtta. | Last Saturday I woke up at eight.\nBara svenska.\n? När vaknade jag? | Jag vaknade klockan åtta. | 1', 'seed:x', true);
  const pool = builderPool({ notes, texts: [text] });

  it('takes translate cards, reorder cards with an English hint, example and phrase pairs, and text lines', () => {
    expect(pool.map((i) => [i.source, i.en, i.sv, i.lesson])).toEqual([
      ['translate', 'Where do you live?', 'Var bor du?', 4],
      ['reorder', 'Then I sat on the sofa.', 'Sedan satt jag i soffan.', 4],
      ['example', 'Yesterday I wrote a list.', 'I går skrev jag en lista.', 4],
      ['example', 'How nice!', 'Vad bra!', 1],
      ['text', 'Last Saturday I woke up at eight.', 'I lördags vaknade jag klockan åtta.', 4],
    ]);
    // A translate card is rated directly; the rest get a note of their own.
    expect(pool[0]).toMatchObject({ noteId: 't1', hasNote: true });
    expect(pool[1]).toMatchObject({ noteId: builderNoteId('Sedan satt jag i soffan.'), hasNote: false });
  });

  it('leaves out resting cards and deleted ones', () => {
    expect(builderPool({ notes, texts: [], resting: new Set(['t1', 'w3']) }).some((i) => i.sv === 'Var bor du?')).toBe(false);
    expect(builderPool({ notes: notes.map((n) => ({ ...n, deletedAt: 1 })), texts: [] })).toEqual([]);
  });

  it('gives the same sentence the same note id however it is written', () => {
    expect(builderNoteId('Sedan satt jag i soffan.')).toBe(builderNoteId('sedan satt jag  i soffan'));
    expect(builderNoteId('Igår var jag hemma. // Jag var hemma igår.')).toBe(builderNoteId('I går var jag hemma.'));
    expect(builderNoteId('Sedan satt jag i soffan.')).not.toBe(builderNoteId('Sedan satt vi i soffan.'));
    expect(builderNoteId('Sedan satt jag i soffan.')).toMatch(/^builder:[0-9a-f]{8}:\d+$/);
  });
});

describe('a session', () => {
  const item = (key: string, lesson: number | null): BuilderItem => ({ key, en: key, sv: key, explanation: '', lesson, source: 'example', noteId: key, hasNote: true, tags: [] });
  const current = Array.from({ length: 20 }, (_, i) => item(`c${i}`, 6 + (i % 3)));
  const older = Array.from({ length: 20 }, (_, i) => item(`o${i}`, 1 + (i % 5)));
  const opts = { size: 10, currentWeek: 1, currentLesson: 8, cards: new Map(), now: 1000 };
  const split = (picked: BuilderItem[]) => [picked.filter((i) => i.key.startsWith('c')).length, picked.filter((i) => i.key.startsWith('o')).length];

  it('knows what "this week" is: a lesson of the week that I have reached', () => {
    expect(isCurrent({ lesson: 6 }, 1, 8)).toBe(true);
    expect(isCurrent({ lesson: 8 }, 1, 6)).toBe(false);
    expect(isCurrent({ lesson: 5 }, 1, 8)).toBe(false);
    expect(isCurrent({ lesson: null }, 1, 8)).toBe(false);
    // Lessons 1 to 5 are week 0.
    expect(isCurrent({ lesson: 4 }, 0, 5)).toBe(true);
  });

  it('is 70% this week and 30% older, for any size', () => {
    expect(split(pickSession([...current, ...older], { ...opts, rng: seeded(1) }))).toEqual([7, 3]);
    expect(split(pickSession([...current, ...older], { ...opts, size: 5, rng: seeded(2) }))).toEqual([4, 1]);
    expect(split(pickSession([...current, ...older], { ...opts, size: 20, rng: seeded(3) }))).toEqual([14, 6]);
    const again = pickSession([...current, ...older], { ...opts, rng: seeded(1) });
    expect(pickSession([...current, ...older], { ...opts, rng: seeded(1) })).toEqual(again);
    expect(new Set(again.map((i) => i.key)).size).toBe(10);
  });

  it('fills from the other side when one runs short', () => {
    expect(split(pickSession([...current.slice(0, 2), ...older], { ...opts, rng: seeded(4) }))).toEqual([2, 8]);
    expect(split(pickSession([...current, ...older.slice(0, 1)], { ...opts, rng: seeded(5) }))).toEqual([9, 1]);
    expect(split(pickSession(older, { ...opts, rng: seeded(6) }))).toEqual([0, 10]);
    expect(pickSession(current.slice(0, 3), { ...opts, rng: seeded(7) }).length).toBe(3);
    expect(pickSession([], opts)).toEqual([]);
  });

  it('inside a side: due cards first, then never practised, then the rest', () => {
    const cards = new Map([
      ['c0', { state: CardState.Review, due: 5000, suspended: false }], // not due yet
      ['c1', { state: CardState.Review, due: 500, suspended: false }], // due
      ['c2', { state: CardState.New, due: 0, suspended: false }], // never practised
      ['c4', { state: CardState.Relearning, due: 900, suspended: false }], // due
      ['c5', { state: CardState.Review, due: 100, suspended: true }], // suspended: left out
    ]);
    const six = current.slice(0, 6); // c3 has no card at all: never practised
    const three = pickSession(six, { ...opts, size: 2, cards, rng: seeded(8) }).map((i) => i.key).sort();
    expect(three).toEqual(['c1', 'c4']);
    const four = pickSession(six, { ...opts, size: 4, cards, rng: seeded(9) }).map((i) => i.key).sort();
    expect(four).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(pickSession(six, { ...opts, size: 10, cards, rng: seeded(10) }).map((i) => i.key).sort()).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
  });

  it('rates right as Good, close as Hard, wrong as Again', () => {
    expect([builderGrade('correct'), builderGrade('close'), builderGrade('wrong')]).toEqual([3, 2, 1]);
  });
});

describe('the note behind a sentence', () => {
  const input = { noteId: builderNoteId('Sedan satt jag i soffan.'), deckId: BUILDER_DECK_ID, deckName: BUILDER_DECK, en: 'Then I sat on the sofa.', sv: 'Sedan satt jag i soffan.', explanation: 'Verb second after sedan.', lesson: 4, tags: ['lesson-04', 'sentence-builder'] };

  it('is made once, as a translate card in the Sentence builder deck, tagged with its lesson', async () => {
    const card = (await ensureBuilderCard(input))!;
    expect(card).toMatchObject({ id: `${input.noteId}:translate`, type: 'translate', deckId: BUILDER_DECK_ID, state: CardState.New });
    const again = (await ensureBuilderCard(input))!;
    expect(again.id).toBe(card.id);
    expect((await listNotes()).map((n) => [n.id, n.kind, n.grammar?.prompt, n.grammar?.answer, n.tags, n.lessonNumber])).toEqual([
      [input.noteId, 'translate', 'Then I sat on the sofa.', 'Sedan satt jag i soffan.', ['lesson-04', 'sentence-builder'], 4],
    ]);
    expect((await listCards()).length).toBe(1);
    expect((await listDecks()).map((d) => [d.id, d.name, d.category])).toEqual([[BUILDER_DECK_ID, 'Sentence builder', 'grammar']]);
    // From then on the pool sees it as a translate card to rate directly.
    const pool = builderPool({ notes: await listNotes(), texts: [] });
    expect(pool).toMatchObject([{ noteId: input.noteId, hasNote: true, source: 'translate' }]);
  });

  it('stays deleted if I delete it', async () => {
    await ensureBuilderCard(input);
    const { deleteNote } = await import('../db/repo');
    await deleteNote(input.noteId);
    expect(await ensureBuilderCard(input)).toBeUndefined();
    expect((await db.notes.toArray()).length).toBe(1);
  });
});
