import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { db } from './db';
import { getKV, listDecks, listGrammarPages, listNotes, setKV } from './repo';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.resetModules();
});

const names = async () => (await listDecks()).map((d) => d.name);

it('a new device gets every lesson and the notes pages in order', async () => {
  await (await import('./seed')).ensureSeeded();
  expect(await names()).toEqual(expect.arrayContaining(['Lesson 01 – -ade verbs', 'Lesson 03 – Irregular verbs', 'Phrases – Lesson 03 – Irregular verbs', 'Grammar – Lesson 03 – Irregular verbs', 'Lesson 05 – Modals, pronouns and review', 'Phrases – Lesson 05 – Modals, pronouns and review', 'Grammar – Lesson 05 – Modals, pronouns and review']));
  expect((await listGrammarPages()).map((p) => p.slug).slice(0, 4)).toEqual(['past-ade', 'past-te-de', 'irregular', 'verb-second']);
  expect((await listGrammarPages()).map((p) => p.slug).slice(4, 8)).toEqual(['questions', 'modals', 'pronouns', 'connectors']);
  expect(await getKV('builtInLessons')).toEqual(['lesson-03-irregular-verbs.txt', 'lesson-05-modals-pronouns-review.txt']);
  const notes = await listNotes();
  expect(notes.find((n) => n.swedish === 'måste' && n.lessonNumber === 5)?.pos).toBe('verb');
  expect(notes.find((n) => n.swedish === 'han, honom')?.verb ?? null).toBeNull();
});

it('a notes page I never edited gets its new text, an edited one is left alone', async () => {
  await (await import('./seed')).ensureSeeded();
  const { ensureGrammarPages, updateGrammarPage } = await import('./repo');
  const page = async (slug: string) => (await listGrammarPages()).find((p) => p.slug === slug)!;
  const current = (await page('modals')).markdown;
  await db.grammarPages.update('page:modals', { markdown: 'old text' });
  await updateGrammarPage('page:inte', { markdown: 'my own notes' });
  await ensureGrammarPages();
  expect((await page('modals')).markdown).toBe(current);
  expect((await page('inte')).markdown).toBe('my own notes');
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
