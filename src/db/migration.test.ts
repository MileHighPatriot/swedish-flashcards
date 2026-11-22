import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { FlashcardDB } from './db';
import { DEFAULT_SETTINGS } from './types';

/** The schema exactly as it was at version 3, before this update. */
class V3 extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      decks: 'id, name, updatedAt',
      notes: 'id, deckId, swedish, *tags, updatedAt',
      cards: 'id, noteId, deckId, due, state, updatedAt',
      reviews: 'id, cardId, reviewedAt, updatedAt',
      media: 'id, updatedAt',
      grammarPages: 'id, slug, updatedAt',
      mistakes: 'id, cardId, at, updatedAt',
      kv: 'key',
    });
    this.version(2).stores({ tts: 'key' });
    this.version(3).stores({ texts: 'id, updatedAt', journal: 'id, date, updatedAt' });
  }
}

const meta = (id: string, t: number) => ({ id, createdAt: t, updatedAt: t + 5, deletedAt: null });

it('a version 3 database opens under version 4 with every row unchanged and the new tables empty', async () => {
  const name = 'migrate-v3-to-v4';
  const old = new V3(name);
  const rows = {
    decks: [{ ...meta('d1', 1000), name: 'Lesson 02', category: 'vocab', lessonNumber: 2, lessonName: 'x', description: '', locked: false }],
    notes: [
      { ...meta('n1', 2000), deckId: 'd1', kind: 'vocab', grammar: null, swedish: 'igår', english: 'yesterday', pos: 'other', exampleSv: 'Igår arbetade jag.', exampleEn: 'Yesterday I worked.', notes: '', tags: ['time-words', 'lesson-02'], lessonNumber: 2, lessonName: 'x', noun: null, verb: null, adjective: null, audioId: null, imageId: null, cardTypes: ['basic', 'reverse'] },
      { ...meta('n2', 2001), deckId: 'd1', kind: 'fix', grammar: { prompt: 'Igår jag arbetade.', answer: 'Igår arbetade jag.', explanation: 'Seat 2.', topic: null }, swedish: '', english: '', pos: 'other', exampleSv: '', exampleEn: '', notes: '', tags: ['my-mistake'], lessonNumber: null, lessonName: '', noun: null, verb: null, adjective: null, audioId: null, imageId: null, cardTypes: ['fix'] },
    ],
    cards: [
      // A reviewed card: nothing about its schedule is a default value.
      { ...meta('c1', 3000), noteId: 'n1', deckId: 'd1', type: 'basic', suspended: false, leech: true, due: 1_790_000_000_000, stability: 12.34, difficulty: 6.78, elapsedDays: 5, scheduledDays: 13, learningSteps: 1, reps: 9, lapses: 6, state: 2, lastReview: 1_789_000_000_000 },
      { ...meta('c2', 3001), noteId: 'n1', deckId: 'd1', type: 'reverse', suspended: true, leech: false, due: 1_780_000_000_000, stability: 0.4, difficulty: 8.1, elapsedDays: 0, scheduledDays: 0, learningSteps: 2, reps: 3, lapses: 1, state: 3, lastReview: 1_779_999_000_000 },
    ],
    reviews: [{ ...meta('r1', 4000), cardId: 'c1', noteId: 'n1', deckId: 'd1', rating: 1, state: 2, reviewedAt: 1_789_000_000_000, scheduledDays: 13, stability: 12.34, difficulty: 6.78, durationMs: 4321, cram: false }],
    mistakes: [{ ...meta('m1', 5000), at: 5000, cardId: 'c1', noteId: 'n1', prompt: 'yesterday', typed: 'igar', correct: 'igår', tags: ['time-words'], topic: null, manual: false }],
    grammarPages: [{ ...meta('page:mine', 6000), slug: 'mine', title: 'Mine', markdown: '# Mine', order: 3 }],
    texts: [{ ...meta('t1', 7000), title: 'Min text', body: 'Hej | Hi' }],
    journal: [{ ...meta('journal:2026-11-20', 8000), date: '2026-11-20', text: 'Igår var jag hemma.', feedback: 'fix | a | b | c | d' }],
    kv: [
      { key: 'settings', value: { newPerDay: 7, dayStartHour: 3, defaultCardTypes: ['basic', 'typed'] }, updatedAt: 9000 },
      { key: 'builtInLessons', value: ['lesson-03-irregular-verbs.txt'], updatedAt: 9001 },
    ],
    tts: [{ key: 'sofie|hej', data: new ArrayBuffer(4), mime: 'audio/mpeg', at: 9002 }],
  };
  for (const [table, list] of Object.entries(rows)) await old.table(table).bulkAdd(list);
  expect(old.verno).toBe(3);
  old.close();

  const db = new FlashcardDB(name);
  await db.open();
  expect(db.verno).toBe(4);
  for (const [table, list] of Object.entries(rows)) {
    if (table === 'tts') expect(await db.table(table).count()).toBe(1);
    else {
      // Rows come back in primary-key order.
      const key = (r: object) => String((r as { id?: string; key?: string }).id ?? (r as { key?: string }).key);
      const sorted = (xs: object[]) => [...xs].sort((a, b) => key(a).localeCompare(key(b)));
      expect(sorted(await db.table(table).toArray()), table).toEqual(sorted(list));
    }
  }
  for (const table of ['mistakeItems', 'checkpoints', 'lessons', 'hours']) {
    expect(db.tables.map((t) => t.name)).toContain(table);
    expect(await db.table(table).count(), table).toBe(0);
  }
  // Settings saved before the update read back with the new options at their defaults.
  const saved = (await db.kv.get('settings'))!.value as object;
  expect({ ...DEFAULT_SETTINGS, ...saved }).toMatchObject({ newPerDay: 7, dayStartHour: 3, defaultCardTypes: ['basic', 'typed'], typeReverse: true, currentLesson: null, builderSize: 10, hoursCountAuto: true });
  db.close();
  await Dexie.delete(name);
});
