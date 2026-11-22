import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../seed/grammar-lessons-01-02.txt?raw', () => ({ default: '' }));
vi.mock('../../seed/lessons-01-02-extras.txt?raw', () => ({ default: '' }));

import { db } from '../db/db';
import { listCards, listDecks, listNotes, updateNote, updateSettings, getSettings } from '../db/repo';
import { csvToGroups, exportBackup, notesToCSV, parseCSV, restoreBackup, toCSV } from './backup';
import { applyPlan, buildPlan, loadStarterLessons } from './importer';

const seed = (f: string) => readFileSync(new URL(`../../seed/${f}`, import.meta.url), 'utf8');
const wipe = () => Promise.all(db.tables.map((t) => t.clear()));
const opts = { lessonNumber: null, lessonName: '', extraTags: [], cardTypes: ['basic' as const, 'reverse' as const] };

beforeEach(async () => {
  await wipe();
});

describe('CSV', () => {
  it('round-trips quotes, commas, newlines and å ä ö', () => {
    const rows = [['a,b', 'say "hej"', 'line\nbreak', 'åäö', '']];
    expect(parseCSV(toCSV(rows))).toEqual(rows);
  });

  it('exports every deck and imports it back identically', async () => {
    await loadStarterLessons([seed('grammar-lessons-01-02.txt'), seed('lessons-01-02-extras.txt')]);
    const before = await listNotes();
    const csv = notesToCSV(before, await listDecks());
    await wipe();

    const { groups, errors } = csvToGroups(csv, 'Fallback');
    expect(errors).toEqual([]);
    const r = await applyPlan(await buildPlan(groups, { sameDeck: 'skip', otherDeck: 'add' }), opts);
    expect(r.added).toBe(before.length);

    const after = await listNotes();
    const decks = new Map((await listDecks()).map((d) => [d.id, d]));
    const shape = (n: (typeof after)[number], name: string) =>
      JSON.stringify([name, n.kind, n.swedish, n.english, n.pos, n.noun, n.verb, n.exampleSv, n.exampleEn, n.notes, n.tags, n.grammar, n.cardTypes]);
    const beforeDecks = new Map<string, string>();
    // deck ids changed, so compare by name
    const csvNames = parseCSV(csv).slice(1).map((row) => row[0]);
    before.forEach((n, i) => beforeDecks.set(n.id, csvNames[i]));
    expect(after.map((n) => shape(n, decks.get(n.deckId)!.name)).sort()).toEqual(before.map((n) => shape(n, beforeDecks.get(n.id)!)).sort());
    expect(decks.size).toBe(8);
    expect([...decks.values()].find((d) => d.name === 'Conversation phrases')!.category).toBe('phrases');
  });

  it('reads a plain sheet with a simple header, or none at all', () => {
    const a = csvToGroups('Swedish,English,Tags\nhund,dog,"animals, pets"\n', 'My deck');
    expect(a.groups[0].deck.name).toBe('My deck');
    expect(a.groups[0].items[0].draft).toMatchObject({ swedish: 'hund', english: 'dog', tags: ['animals', 'pets'] });
    const b = csvToGroups('hund,dog,"en hund, hundar"\nkatt;cat\n', 'My deck');
    expect(b.groups[0].items[0].draft.noun).toEqual({ gender: 'en', definite: '', plural: 'hundar' });
    const c = csvToGroups('swedish,english\n,missing\n', 'x');
    expect(c.errors).toHaveLength(1);
    expect(c.errors[0].line).toBe(2);
  });
});

describe('JSON backup', () => {
  it('restores everything exactly after a wipe', async () => {
    await loadStarterLessons([seed('grammar-lessons-01-02.txt')]);
    await updateSettings({ targetRetention: 0.85 });
    const snapshot = async () => ({ decks: await listDecks(), notes: await listNotes(), cards: await listCards(), settings: await getSettings() });
    const before = await snapshot();
    const file = JSON.parse(JSON.stringify(await exportBackup())); // through real JSON, as a download would be

    await wipe();
    expect(await listNotes()).toHaveLength(0);
    const summary = await restoreBackup(file, 'replace');
    expect(summary).toMatchObject({ decks: 5, notes: 88 });
    expect(await snapshot()).toEqual(before);
  });

  it('merge keeps whichever side changed a card last', async () => {
    await loadStarterLessons([seed('grammar-lessons-01-02.txt')]);
    const note = (await listNotes()).find((n) => n.swedish === 'i går')!;
    const file = JSON.parse(JSON.stringify(await exportBackup()));

    await new Promise((r) => setTimeout(r, 5));
    await updateNote(note.id, { english: 'yesterday (edited later)' });
    await restoreBackup(file, 'merge');
    expect((await listNotes()).find((n) => n.id === note.id)!.english).toBe('yesterday (edited later)');
    expect(await listNotes()).toHaveLength(88);
  });

  it('rejects files that are not a backup', async () => {
    await expect(restoreBackup({ hello: 'world' }, 'replace')).rejects.toThrow(/not a Svenska Kort backup/);
    await expect(restoreBackup(null, 'merge')).rejects.toThrow();
  });
});

describe('backups across the version 4 update', () => {
  it('a backup made before the update (no new tables) still restores, in both modes', async () => {
    await loadStarterLessons([seed('grammar-lessons-01-02.txt')]);
    await updateSettings({ newPerDay: 7 });
    const now = JSON.parse(JSON.stringify(await exportBackup()));
    // The file as the old app wrote it: eight tables, media and kv.
    const old = { ...now, tables: { ...now.tables } };
    for (const t of ['mistakeItems', 'checkpoints', 'lessons', 'hours']) delete old.tables[t];
    expect(Object.keys(old.tables).sort()).toEqual(['cards', 'decks', 'grammarPages', 'journal', 'kv', 'media', 'mistakes', 'notes', 'reviews', 'texts']);
    const notes = await db.notes.toArray();
    const cards = await db.cards.toArray();

    await wipe();
    const { recordWrong } = await import('../db/repo');
    await recordWrong({ prompt: 'p', typed: 't', correct: 'c', reason: '', tags: [], cardId: null, noteId: null, source: 'study' });
    const summary = await restoreBackup(old, 'replace');
    expect(summary.notes).toBe(notes.length);
    expect(await db.notes.toArray()).toEqual(notes);
    expect(await db.cards.toArray()).toEqual(cards);
    expect((await getSettings()).newPerDay).toBe(7);
    // Replace means replace: what the old file did not know about is empty, not broken.
    for (const t of ['mistakeItems', 'checkpoints', 'lessons', 'hours']) expect(await db.table(t).count(), t).toBe(0);

    // Merge keeps what this device has added since.
    const mine = await recordWrong({ prompt: 'p', typed: 't', correct: 'c', reason: '', tags: [], cardId: null, noteId: null, source: 'study' });
    await restoreBackup(old, 'merge');
    expect(await db.mistakeItems.get(mine.id)).toEqual(mine);
    expect(await db.notes.count()).toBe(notes.length);
  });

  it('a new backup carries the new tables, journal fields and recordings, but not the device id', async () => {
    const { addHours, getDeviceId, recordWrong, saveCheckpoint, saveJournal, saveLesson, saveMedia } = await import('../db/repo');
    const item = await recordWrong({ prompt: 'p', typed: 't', correct: 'c', reason: 'r', tags: ['x'], cardId: null, noteId: null, source: 'study' });
    const audio = await saveMedia('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }));
    await saveJournal('2026-11-23', { text: 'Hej', prompt: 'Hur var din dag?', promptEn: 'How was your day?', lessonNumber: 1, audioIds: [audio.id] });
    await saveLesson({ number: 6, week: 1, title: 'Negation', checklist: ['a'], speakingPrompt: 'p', writingTask: '', questions: [{ sv: 'Hur var din dag?', en: 'How was your day?' }], report: null });
    await saveCheckpoint({ cp: 'CP1', kind: 'paper', label: 'Checkpoint 1', week: 4, date: '2026-12-20', at: 1, practice: false, recall: 0.9, production: 0.8, writing: 0.7, writingSelfScored: true, speakingWithoutEnglish: true, result: 'pass', items: [], reviewTag: null });
    const hours = await addHours({ date: '2026-11-23', category: 'speaking', minutes: 40 });
    const device = await getDeviceId();

    const file = JSON.parse(JSON.stringify(await exportBackup()));
    expect(file.tables.kv.some((r: { key: string }) => r.key === 'deviceId')).toBe(false);
    await wipe();
    await restoreBackup(file, 'replace');
    expect(await db.mistakeItems.get(item.id)).toEqual(item);
    expect((await db.journal.get('journal:2026-11-23'))!).toMatchObject({ prompt: 'Hur var din dag?', lessonNumber: 1, audioIds: [audio.id] });
    expect((await db.lessons.get('lesson:6'))!.questions).toEqual([{ sv: 'Hur var din dag?', en: 'How was your day?' }]);
    expect((await db.checkpoints.toArray())[0]).toMatchObject({ cp: 'CP1', production: 0.8, result: 'pass' });
    expect(await db.hours.get(hours.id)).toEqual(hours);
    expect((await db.media.get(audio.id))!.mime).toBe('audio/webm');
    expect(await getDeviceId()).not.toBe(device);
  });
});
