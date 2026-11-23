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
  expect(await getKV('builtInLessons')).toEqual(['lesson-03-irregular-verbs.txt', 'lesson-04-mixed-past-irregular.txt', 'lesson-05-modals-pronouns-review.txt']);
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

it('a seed revision reaches a device that already loaded the lessons, and lesson 04 arrives', async () => {
  await (await import('./seed')).ensureSeeded();
  expect(await getKV('builtInRevision')).toBe(1);
  expect(await getKV('starterRevision')).toBe(3);
  expect(await names()).toEqual(expect.arrayContaining(['Lesson 04 – Mixed past tense and seven irregular verbs', 'Grammar – Lesson 04 – Mixed past tense and seven irregular verbs']));
  const count = (await listNotes()).length;
  // The device as it was before the revision: the old example, never edited, and no revision recorded.
  const ni = (await listNotes()).find((n) => n.swedish === 'ni, er')!;
  await db.notes.update(ni.id, { exampleSv: 'Kom med oss!', exampleEn: 'Come with us!' });
  await db.kv.delete('builtInRevision');

  vi.resetModules();
  await (await import('./seed')).ensureSeeded();
  expect((await listNotes()).find((n) => n.id === ni.id)).toMatchObject({ exampleSv: 'Kan jag hjälpa er?', exampleEn: 'Can I help you (all)?' });
  expect((await listNotes()).length).toBe(count);
  expect((await listNotes()).some((n) => n.grammar?.prompt === 'Vi såg på film.')).toBe(false);
  // The var-vart tag has no notes page, so a card tagged only with it links to none.
  const { topicFor } = await import('../lib/topics');
  const rule = (await listNotes()).find((n) => n.tags.includes('var-vart') && n.kind === 'rule');
  expect(rule && topicFor({ tags: ['var-vart'], grammar: rule.grammar })).toBeNull();
});

it('the Lesson 1 and 2 starter decks get their lesson number stored, and nothing else changes', async () => {
  await (await import('./seed')).ensureSeeded();
  const decks = await listDecks();
  const byName = (n: string) => decks.find((d) => d.name === n)!;
  expect(byName('Lesson 01 – -ade verbs').lessonNumber).toBe(1);
  expect(byName('Lesson 02 – -te and -de verbs').lessonNumber).toBe(2);
  // Decks that are not a lesson keep none, and the lessons that had one keep theirs.
  expect(byName('Spelling watch-list').lessonNumber).toBeNull();
  expect(byName('Grammar – My mistakes').lessonNumber).toBeNull();
  expect(byName('Lesson 05 – Modals, pronouns and review').lessonNumber).toBe(5);
  // Still built-in rows: stamped inside the seed window, so they never upload.
  const { SEED_TIME, setStarterDeckLessons } = await import('./repo');
  expect(byName('Lesson 01 – -ade verbs').updatedAt).toBeLessThan(SEED_TIME + 1_000_000);
  // My current lesson is still the newest one, not changed by this.
  const { currentLesson } = await import('../lib/plan');
  expect(currentLesson(decks, { currentLesson: null })).toBe(5);

  // A device from before: the number missing, the flag not set. It is filled in on the next start, once.
  await db.decks.update(byName('Lesson 02 – -te and -de verbs').id, { lessonNumber: null });
  await db.kv.delete('starterDeckLessons');
  const cards = await db.cards.toArray();
  const notes = await db.notes.toArray();
  vi.resetModules();
  await (await import('./seed')).ensureSeeded();
  expect((await listDecks()).find((d) => d.name === 'Lesson 02 – -te and -de verbs')!.lessonNumber).toBe(2);
  expect(await db.cards.toArray()).toEqual(cards);
  expect(await db.notes.toArray()).toEqual(notes);
  expect(await setStarterDeckLessons()).toBe(0);
});
