import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { SEED_TIME, listMistakeItems, recordCorrect, recordTyped, recordWrong, seedMistakeItems } from '../db/repo';
import type { MistakeItem } from '../db/types';
import { applyCorrect, applyWrong, dayCount, dueItems, mistakeKey, parseMistakeSeed, type WrongInput } from './mistakeItems';
import { checkAnswer } from './check';

// Local time, so the 4 a.m. day boundary is the one the app uses.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const input = (over: Partial<WrongInput> = {}): WrongInput => ({
  prompt: 'I called her yesterday.',
  typed: 'Jag ringade henne i går.',
  correct: 'Jag ringde henne i går. // I går ringde jag henne.',
  reason: 'Ringer ends in -er, so never -ade.',
  tags: ['-de'],
  cardId: null,
  noteId: null,
  source: 'study',
  ...over,
});
let n = 0;
const id = () => `id-${++n}`;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('retirement', () => {
  it('takes right answers on three different study days', () => {
    let item = applyWrong(undefined, input(), at(20, 10), id);
    item = applyCorrect(item, at(20, 11), 4);
    expect(dayCount(item)).toBe('1 of 3 days');
    item = applyCorrect(item, at(21, 9), 4);
    expect(item.retiredAt).toBeNull();
    item = applyCorrect(item, at(22, 9), 4);
    expect(item.correctDays).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
    expect(item.retiredAt).toBe(at(22, 9));
  });

  it('counts several right answers on one day once', () => {
    let item = applyWrong(undefined, input(), at(20, 10), id);
    for (const hour of [11, 12, 15, 23]) item = applyCorrect(item, at(20, hour), 4);
    expect(item.correctDays).toEqual(['2026-11-20']);
    expect(item.retiredAt).toBeNull();
  });

  it('uses the study day: 03:59 still belongs to yesterday, 04:00 is a new day', () => {
    let item = applyWrong(undefined, input(), at(20, 10), id);
    item = applyCorrect(item, at(20, 23, 30), 4);
    item = applyCorrect(item, at(21, 3, 59), 4);
    expect(item.correctDays).toEqual(['2026-11-20']);
    item = applyCorrect(item, at(21, 4, 0), 4);
    expect(item.correctDays).toEqual(['2026-11-20', '2026-11-21']);
    // With the day starting at midnight the same 03:59 answer is a new day.
    let other = applyWrong(undefined, input(), at(20, 10), id);
    other = applyCorrect(applyCorrect(other, at(20, 23, 30), 0), at(21, 3, 59), 0);
    expect(other.correctDays).toEqual(['2026-11-20', '2026-11-21']);
  });

  it('a wrong answer in between resets the days', () => {
    let item = applyWrong(undefined, input(), at(18, 10), id);
    item = applyCorrect(applyCorrect(item, at(18, 11), 4), at(19, 11), 4);
    item = applyWrong(item, input({ typed: 'Jag ringte henne i går.' }), at(20, 9), id);
    expect(item).toMatchObject({ correctDays: [], timesWrong: 2, typed: 'Jag ringte henne i går.', lastWrongAt: at(20, 9), firstWrongAt: at(18, 10) });
    item = applyCorrect(applyCorrect(item, at(20, 10), 4), at(21, 10), 4);
    expect(item.retiredAt).toBeNull();
    expect(applyCorrect(item, at(22, 10), 4).retiredAt).not.toBeNull();
  });

  it('a wrong answer on a retired item brings it back', () => {
    let item = applyWrong(undefined, input(), at(18, 10), id);
    for (const day of [18, 19, 20]) item = applyCorrect(item, at(day, 12), 4);
    expect(item.retiredAt).not.toBeNull();
    item = applyWrong(item, input(), at(25, 12), id);
    expect(item).toMatchObject({ retiredAt: null, correctDays: [], timesWrong: 2 });
  });
});

describe('one item per mistake', () => {
  it('keys on the right answer plus the card, or the prompt when there is no card', () => {
    expect(mistakeKey('Jag ringde henne i går. // I går ringde jag henne.', null, 'I called her yesterday.')).toBe('jag ringde henne i går|i called her yesterday');
    expect(mistakeKey('Jag ringde henne igår', 'card-1', 'whatever')).toBe('jag ringde henne i går|card-1');
  });

  it('a second wrong answer updates the same row; another card makes another', async () => {
    const a = await recordWrong(input(), at(20, 10));
    const b = await recordWrong(input({ typed: 'Jag ringte henne i går.' }), at(20, 11));
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ timesWrong: 2, typed: 'Jag ringte henne i går.' });
    await recordWrong(input({ cardId: 'card-9' }), at(20, 12));
    expect((await listMistakeItems()).length).toBe(2);
  });

  it('typed answers: wrong makes an item, close does nothing, right counts a day only for something on the list', async () => {
    await recordTyped('close', input(), at(20, 9));
    await recordTyped('correct', input(), at(20, 9));
    expect(await listMistakeItems()).toEqual([]);
    await recordTyped('wrong', input({ typed: '   ' }), at(20, 9));
    expect(await listMistakeItems()).toEqual([]);
    await recordTyped('wrong', input(), at(20, 10));
    await recordTyped('correct', input(), at(20, 11));
    const [item] = await listMistakeItems();
    expect(item.correctDays).toEqual(['2026-11-20']);
  });

  it('retires through the database, and comes back when missed again', async () => {
    const item = await recordWrong(input(), at(18, 10));
    for (const day of [18, 19, 20]) await recordCorrect(item.id, at(day, 12));
    expect((await db.mistakeItems.get(item.id))!.retiredAt).toBe(at(20, 12));
    await recordWrong(input(), at(26, 8));
    expect(await db.mistakeItems.get(item.id)).toMatchObject({ retiredAt: null, timesWrong: 2, correctDays: [] });
    expect(await db.mistakeItems.count()).toBe(1);
  });
});

describe('what a session starts with', () => {
  const make = (over: Partial<MistakeItem>): MistakeItem => ({ ...applyWrong(undefined, input({ prompt: over.id ?? 'x' }), at(10, 10), id), ...over });

  it('most-missed first, then the one waiting longest, capped at 10, skipping what is done today or retired', () => {
    const items = [
      make({ id: 'once-old', timesWrong: 1, lastWrongAt: at(1, 9) }),
      make({ id: 'thrice-new', timesWrong: 3, lastWrongAt: at(9, 9) }),
      make({ id: 'thrice-old', timesWrong: 3, lastWrongAt: at(2, 9) }),
      make({ id: 'twice', timesWrong: 2, lastWrongAt: at(3, 9) }),
      make({ id: 'done-today', timesWrong: 9, correctDays: ['2026-11-20'] }),
      make({ id: 'done-yesterday', timesWrong: 2, lastWrongAt: at(4, 9), correctDays: ['2026-11-19'] }),
      make({ id: 'retired', timesWrong: 9, retiredAt: at(5, 9) }),
      make({ id: 'deleted', timesWrong: 9, deletedAt: at(5, 9) }),
    ];
    expect(dueItems(items, at(20, 12), 4).map((i) => i.id)).toEqual(['thrice-old', 'thrice-new', 'twice', 'done-yesterday', 'once-old']);
    const many = Array.from({ length: 14 }, (_, k) => make({ id: `m${String(k).padStart(2, '0')}`, timesWrong: 1, lastWrongAt: at(1, 9) + k }));
    expect(dueItems(many, at(20, 12), 4).map((i) => i.id)).toEqual(many.slice(0, 10).map((i) => i.id));
    expect(dueItems(many, at(20, 12), 4, Infinity).length).toBe(14);
  });
});

describe('my worksheet mistakes', () => {
  const text = readFileSync(new URL('../../seed/my-mistakes.txt', import.meta.url), 'utf8');
  const rows = parseMistakeSeed(text);

  it('reads all 20 lines with their counts', () => {
    expect(rows.length).toBe(20);
    expect(rows[0]).toMatchObject({ prompt: 'We lived in Denver.', typed: 'Vi borde i Denver.', correct: 'Vi bodde i Denver.', tags: ['-de', 'irregular'], timesWrong: 3 });
    expect(rows.reduce((sum, r) => sum + r.timesWrong, 0)).toBe(36);
    // What I wrote is really wrong, and the right answer really checks out, for every line.
    for (const r of rows) {
      expect(checkAnswer(r.typed, r.correct).verdict, r.typed).toBe('wrong');
      expect(checkAnswer(r.correct.split(' // ')[0], r.correct).verdict).toBe('correct');
    }
    // The removed card is not brought back as a mistake.
    expect(text).not.toContain('Vi såg på film');
  });

  it('loads exactly once, with fixed ids and seed stamps', async () => {
    expect(await seedMistakeItems(rows)).toBe(20);
    const first = await db.mistakeItems.toArray();
    expect(await seedMistakeItems(rows)).toBe(0);
    expect(await db.mistakeItems.toArray()).toEqual(first);
    expect(first.every((i) => i.id.startsWith('seed:mistake:') && i.updatedAt < SEED_TIME + 1_000_000 && i.source === 'seed')).toBe(true);
    expect(new Set(first.map((i) => i.id)).size).toBe(20);
    // The session opens with the ones I missed most.
    expect(dueItems(first, Date.now(), 4).map((i) => i.timesWrong)).toEqual([3, 3, 3, 3, 2, 2, 2, 2, 2, 2]);
    expect(dueItems(first, Date.now(), 4)[0].prompt).toBe('We lived in Denver.');
  });

  it('through the app start: seeded once per device, and an answer does not bring a second copy', async () => {
    const { ensureSeeded } = await import('../db/seed');
    await ensureSeeded();
    expect(await db.mistakeItems.count()).toBe(20);
    const item = (await listMistakeItems()).find((i) => i.prompt === 'She made dinner.')!;
    await recordTyped('wrong', { ...input({ prompt: item.prompt, typed: 'Hon görde middag.', correct: item.correct }) });
    expect(await db.mistakeItems.count()).toBe(20);
    expect(await db.mistakeItems.get(item.id)).toMatchObject({ timesWrong: 3, typed: 'Hon görde middag.' });
  });
});
