import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { db } from './db';
import { getKV, listDecks, listGrammarPages, listNotes, setKV } from './repo';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.resetModules();
});

const names = async () => (await listDecks()).map((d) => d.name);

it('a new device gets lessons 1 to 3 and the Irregular verbs page', async () => {
  await (await import('./seed')).ensureSeeded();
  expect(await names()).toEqual(expect.arrayContaining(['Lesson 01 – -ade verbs', 'Lesson 03 – Irregular verbs', 'Phrases – Lesson 03 – Irregular verbs', 'Grammar – Lesson 03 – Irregular verbs']));
  expect((await listGrammarPages()).map((p) => p.slug).slice(0, 4)).toEqual(['past-ade', 'past-te-de', 'irregular', 'verb-second']);
  expect(await getKV('builtInLessons')).toEqual(['lesson-03-irregular-verbs.txt']);
});

it('a device set up before Lesson 3 gets it on the next start, once', async () => {
  // How the device looked before this update: no Lesson 3 file, no Irregular verbs page.
  vi.doMock('../lib/importer', async (original) => ({ ...(await original<typeof import('../lib/importer')>()), BUILT_IN_LESSONS: [] }));
  await (await import('./seed')).ensureSeeded();
  vi.doUnmock('../lib/importer');
  await db.grammarPages.where('slug').equals('irregular').delete();
  await db.kv.delete('builtInLessons');
  await setKV('grammarSeeded', true);
  const waiting = (await listNotes()).find((n) => n.swedish === 'gå')!;
  expect(await names()).not.toContain('Lesson 03 – Irregular verbs');

  vi.resetModules();
  await (await import('./seed')).ensureSeeded();
  expect(await names()).toContain('Lesson 03 – Irregular verbs');
  expect((await listGrammarPages()).some((p) => p.slug === 'irregular')).toBe(true);
  const lesson = (await listDecks()).find((d) => d.name === 'Lesson 03 – Irregular verbs')!;
  expect((await listNotes()).filter((n) => n.swedish === 'gå').map((n) => [n.id, n.deckId])).toEqual([[waiting.id, lesson.id]]);
  const count = (await listNotes()).length;

  vi.resetModules();
  await (await import('./seed')).ensureSeeded();
  expect((await listNotes()).length).toBe(count);
});
