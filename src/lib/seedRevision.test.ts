import 'fake-indexeddb/auto';
import { readFileSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { SEED_ID_ALIASES } from '../data/seedIdAliases';
import { db } from '../db/db';
import { SEED_TIME, saveReview, updateNote } from '../db/repo';
import type { Card, Note } from '../db/types';
import {
  REMOVED_SEED_IDS,
  groupLesson,
  groupStarter,
  loadBuiltInLesson,
  loadStarterLessons,
  refreshBuiltIn,
  refreshStarterCards,
  seedNoteIdRaw,
  toBuiltInLesson,
  type DraftGroup,
} from './importer';
import { parseLesson } from './parser';
import { createScheduler } from './scheduler';
import { twoWordTime } from './timewords';

// The seed files as they were at commit 3d9e3c9 (one-word time adverbs, the
// "Vi såg på film" card, the old pronunciation hint), and as they are now.
const old = (f: string) => readFileSync(new URL(`./__fixtures__/seed-3d9e3c9/${f}`, import.meta.url), 'utf8');
const now = (f: string) => readFileSync(new URL(`../../seed/${f}`, import.meta.url), 'utf8');
const STARTER = ['grammar-lessons-01-02.txt', 'lessons-01-02-extras.txt'];
const L3 = 'lesson-03-irregular-verbs.txt';
const L4 = 'lesson-04-mixed-past-irregular.txt';
const L5 = 'lesson-05-modals-pronouns-review.txt';
const SEED_END = SEED_TIME + 1_000_000;

function groupsOf(read: (f: string) => string, lessons: string[]): DraftGroup[] {
  return [
    ...STARTER.flatMap((f) => groupStarter(parseLesson(read(f)))),
    ...lessons.flatMap((f) => {
      const l = toBuiltInLesson(f, read(f));
      return groupLesson(parseLesson(l.text), l.number, l.name);
    }),
  ];
}
const idsOf = (groups: DraftGroup[]) => groups.flatMap((g) => g.items.map((i) => seedNoteIdRaw(g.deck.name, i.draft)));

/** new id → old id, for every card whose id text changed only in how a time word is spelled. */
function computeAliases(): Record<string, string> {
  const oldIds = [...new Set(idsOf(groupsOf(old, [L3, L5])))];
  const out: Record<string, string> = {};
  for (const id of new Set(idsOf(groupsOf(now, [L3, L5])))) {
    if (oldIds.includes(id)) continue;
    const twins = oldIds.filter((o) => twoWordTime(o) === twoWordTime(id));
    if (twins.length > 1) throw new Error(`Two old ids fold to ${id}: ${twins.join(' and ')}`);
    if (twins.length === 1) out[id] = twins[0];
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

describe('seed id aliases', () => {
  it('the committed table is exactly what the old and new seed files give', () => {
    const aliases = computeAliases();
    if (process.env.WRITE_SEED_ALIASES) {
      const head = readFileSync(new URL('../data/seedIdAliases.ts', import.meta.url), 'utf8').split('export const')[0];
      const body = Object.entries(aliases).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
      writeFileSync(new URL('../data/seedIdAliases.ts', import.meta.url), `${head}export const SEED_ID_ALIASES: Record<string, string> = {\n${body}\n};\n`);
      return;
    }
    expect(SEED_ID_ALIASES).toEqual(aliases);
    expect(Object.keys(aliases).length).toBeGreaterThan(20);
    // No two cards share an old id.
    expect(new Set(Object.values(aliases)).size).toBe(Object.keys(aliases).length);
  });

  it('folding igår and i går together changes nothing about how the old files loaded', () => {
    // Two old cards whose keys differ only in a time word must be words in two
    // different open decks: the one case where a duplicate is still simply added.
    const seen = new Map<string, { raw: string; deck: string; kind: string; locked: boolean }[]>();
    for (const g of groupsOf(old, [L3, L5]))
      for (const { draft } of g.items) {
        const raw = seedNoteIdRaw('', draft);
        const k = twoWordTime(raw);
        seen.set(k, [...(seen.get(k) ?? []), { raw, deck: g.deck.name, kind: draft.kind, locked: !!g.deck.locked }]);
      }
    for (const twins of seen.values()) {
      if (new Set(twins.map((t) => t.raw)).size < 2) continue;
      expect(twins.every((t) => t.kind === 'vocab' && !t.locked)).toBe(true);
      expect(new Set(twins.map((t) => t.deck)).size).toBe(twins.length);
    }
  });
});

type Snapshot = Map<string, unknown>;
async function snapshot(): Promise<{ notes: Snapshot; cards: string[]; decks: string[] }> {
  const live = <T extends { deletedAt: number | null }>(rows: T[]) => rows.filter((r) => r.deletedAt == null);
  const notes = live(await db.notes.toArray());
  const text = (n: Note) => ({
    deckId: n.deckId,
    kind: n.kind,
    swedish: n.swedish,
    english: n.english,
    pos: n.pos,
    exampleSv: n.exampleSv,
    exampleEn: n.exampleEn,
    notes: n.notes,
    noun: n.noun,
    verb: n.verb,
    adjective: n.adjective,
    grammar: n.grammar,
    tags: [...n.tags].sort(),
    lessonNumber: n.lessonNumber,
    cardTypes: n.cardTypes,
  });
  return {
    notes: new Map(notes.map((n) => [n.id, text(n)])),
    cards: live(await db.cards.toArray()).map((c) => `${c.id}|${c.deckId}|${c.suspended}`).sort(),
    decks: live(await db.decks.toArray()).map((d) => `${d.id}|${d.name}|${d.locked}`).sort(),
  };
}

const lesson = (read: (f: string) => string, f: string) => toBuiltInLesson(f, read(f));
const ALL_NOW = () => [L3, L4, L5].map((f) => lesson(now, f));

/** A device as it stood before this update: lessons 1, 2, 3 and 5 loaded from the old files. */
async function oldDevice() {
  await loadStarterLessons(STARTER.map(old));
  await loadBuiltInLesson(lesson(old, L3));
  await loadBuiltInLesson(lesson(old, L5));
}

async function upgrade() {
  await refreshStarterCards(STARTER.map(now));
  const changed = await refreshBuiltIn(STARTER.map(now), ALL_NOW());
  await loadBuiltInLesson(lesson(now, L4));
  return changed;
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('built-in revision', () => {
  it('an upgraded device and a fresh install end up with the same ids and the same text', async () => {
    await oldDevice();
    await upgrade();
    const upgraded = await snapshot();

    await Promise.all(db.tables.map((t) => t.clear()));
    await loadStarterLessons(STARTER.map(now));
    for (const f of [L3, L4, L5]) await loadBuiltInLesson(lesson(now, f));
    const fresh = await snapshot();

    expect([...upgraded.notes.keys()].sort()).toEqual([...fresh.notes.keys()].sort());
    expect(upgraded.cards).toEqual(fresh.cards);
    expect(upgraded.decks).toEqual(fresh.decks);
    for (const [id, text] of fresh.notes) expect(upgraded.notes.get(id), id).toEqual(text);
    // And nothing one-word is left anywhere.
    expect(JSON.stringify([...fresh.notes.values()])).not.toMatch(/\b(igår|idag|imorgon|ikväll)\b/i);
    expect(JSON.stringify([...upgraded.notes.values()])).not.toMatch(/\b(igår|idag|imorgon|ikväll)\b/i);
  });

  it('keeps every id, card and review, and changes the three cited lines', async () => {
    await oldDevice();
    const before = { notes: await db.notes.toArray(), cards: await db.cards.toArray() };
    const find = (rows: Note[], pick: (n: Note) => boolean) => rows.find(pick)!;
    const ni = find(before.notes, (n) => n.swedish === 'ni, er');
    const film = find(before.notes, (n) => n.grammar?.prompt === 'Vi såg på film.');
    const k = find(before.notes, (n) => !!n.grammar?.prompt.startsWith('How is k pronounced'));
    const igar = find(before.notes, (n) => n.swedish === 'igår');
    expect(ni.exampleSv).toBe('Kom med oss!');
    expect(film.id).toBe(REMOVED_SEED_IDS[0]);
    expect(k.grammar!.answer).toContain('SHERP');

    // Real history on a card whose word is about to be respelled.
    const card = before.cards.find((c) => c.noteId === igar.id && c.type === 'basic')!;
    const { next } = createScheduler({ retention: 0.9, fuzz: false }).rate(card, 3, Date.now());
    await saveReview({ card, next, rating: 3, reviewedAt: Date.now(), durationMs: 4000, leech: false });
    const reviewed = (await db.cards.get(card.id))!;
    // And a card I rewrote myself.
    const mine = find(before.notes, (n) => n.grammar?.prompt === 'Igår jag arbetade.');
    await updateNote(mine.id, { grammar: { ...mine.grammar!, explanation: 'My own words about igår.' } });
    const uploads = async () => [...(await db.notes.where('updatedAt').above(SEED_END).primaryKeys()), ...(await db.cards.where('updatedAt').above(SEED_END).primaryKeys())].sort();
    const uploadsBefore = await uploads();

    expect(await refreshBuiltIn(STARTER.map(now), ALL_NOW())).toBeGreaterThan(50);
    const after = { notes: await db.notes.toArray(), cards: await db.cards.toArray() };

    // Same rows, nothing added, nothing renamed.
    expect(after.notes.map((n) => n.id).sort()).toEqual(before.notes.map((n) => n.id).sort());
    expect(after.cards.map((c) => c.id).sort()).toEqual(before.cards.map((c) => c.id).sort());
    expect(await db.reviews.count()).toBe(1);

    const get = (id: string) => after.notes.find((n) => n.id === id)!;
    expect(get(ni.id)).toMatchObject({ exampleSv: 'Kan jag hjälpa er?', exampleEn: 'Can I help you (all)?' });
    expect(get(k.id).grammar).toMatchObject({ prompt: k.grammar!.prompt, answer: 'As the soft tje-sound, the sound at the start of tjugo: köpte.' });
    expect(get(film.id).deletedAt).not.toBeNull();
    expect(after.cards.filter((c) => c.noteId === film.id).every((c) => c.deletedAt != null)).toBe(true);
    expect(get(igar.id)).toMatchObject({ swedish: 'i går', exampleSv: 'I går arbetade jag.' });

    // The reviewed card is untouched: same schedule, same stamp.
    const strip = ({ updatedAt: _u, ...rest }: Card) => rest;
    expect(strip((await db.cards.get(card.id))!)).toEqual(strip(reviewed));
    // My rewrite survives; only its time word is respelled, and its stamp does not move.
    expect(get(mine.id).grammar).toMatchObject({ prompt: 'I går jag arbetade.', explanation: 'My own words about i går.' });
    expect(get(mine.id).updatedAt).toBe((await db.notes.get(mine.id))!.updatedAt);
    // Nothing new would upload: every row the revision touched is stamped inside the seed window.
    expect(await uploads()).toEqual(uploadsBefore);

    // Running it again changes nothing, and reloading the lessons does not bring the removed card back.
    expect(await refreshBuiltIn(STARTER.map(now), ALL_NOW())).toBe(0);
    await loadStarterLessons(STARTER.map(now));
    await loadBuiltInLesson(lesson(now, L5));
    expect((await db.notes.get(film.id))!.deletedAt).not.toBeNull();
    expect((await db.notes.toArray()).filter((n) => n.deletedAt == null && n.grammar?.prompt === 'Vi såg på film.')).toEqual([]);
  });

  it('lesson 04 moves the waiting verbs out of the locked deck and doubles nothing', async () => {
    await oldDevice();
    await upgrade();
    const notes = (await db.notes.toArray()).filter((n) => n.deletedAt == null);
    const decks = new Map((await db.decks.toArray()).map((d) => [d.id, d]));
    const l4 = [...decks.values()].find((d) => d.name === 'Lesson 04 – Mixed past tense and seven irregular verbs')!;
    const words = ['skriva', 'sitta', 'stå', 'ligga', 'säga', 'bli', 'dricka', 'vakna', 'soffa', 'golv', 'kök', 'lista', 'eftermiddag'];
    for (const w of words) {
      const rows = notes.filter((n) => n.kind === 'vocab' && n.swedish === w);
      expect(rows.map((n) => n.deckId), w).toEqual([l4.id]);
    }
    const moved = notes.filter((n) => n.deckId === l4.id && n.id.includes('coming soon')).map((n) => n.swedish).sort((a, b) => a.localeCompare(b, 'sv'));
    expect(moved).toEqual(['ligga', 'sitta', 'skriva', 'stå', 'säga']);
    expect(notes.find((n) => n.swedish === 'skriva')!.verb).toEqual({ infinitive: 'skriva', present: 'skriver', past: 'skrev', supine: 'skrivit' });
    expect(notes.find((n) => n.swedish === 'golv')!.noun).toEqual({ gender: 'ett', definite: 'golvet', plural: 'golv' });
    // The var/vart rule already existed in Lesson 3: it is updated in place, not doubled.
    expect(notes.filter((n) => n.grammar?.prompt === 'What is the difference between var and vart?').length).toBe(1);
    const cards = (await db.cards.toArray()).filter((c) => c.deletedAt == null && notes.some((n) => n.id === c.noteId && n.deckId === l4.id));
    expect(cards.every((c) => !c.suspended)).toBe(true);
  });
});
