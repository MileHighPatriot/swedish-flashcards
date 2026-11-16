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
    const note = (await listNotes()).find((n) => n.swedish === 'igår')!;
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
