import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { FlashcardDB } from '../db/db';
import { SEED_TIME } from '../db/repo';
import { CardState, DEFAULT_SETTINGS, type Card, type Note, type ReviewLog } from '../db/types';
import { newSchedState } from '../lib/scheduler';
import { resetSyncCursors, syncOnce, type OutgoingRow, type Remote, type RemoteRow } from './engine';

/** Behaves like the SQL: keeps the newer copy, stamps a rising server time. */
class FakeRemote implements Remote {
  rows = new Map<string, RemoteRow>();
  clock = 0;
  pushes = 0;
  async push(rows: OutgoingRow[]) {
    this.pushes += rows.length;
    for (const r of JSON.parse(JSON.stringify(rows)) as OutgoingRow[]) {
      const k = `${r.store}/${r.id}`;
      const have = this.rows.get(k);
      if (!have || Date.parse(r.updated_at) > Date.parse(have.updated_at)) this.rows.set(k, { ...r, server_at: new Date(++this.clock * 1000).toISOString() });
    }
  }
  async pull(since: string | null) {
    return [...this.rows.values()].filter((r) => !since || r.server_at > since).sort((a, b) => a.server_at.localeCompare(b.server_at));
  }
}

const T = Date.UTC(2026, 10, 16, 12);
let seq = 0;
const meta = (id: string, at: number) => ({ id, createdAt: at, updatedAt: at, deletedAt: null });
const note = (id: string, at: number): Note => ({
  ...meta(id, at), deckId: 'seed:deck:x', kind: 'vocab', grammar: null, swedish: id, english: 'x', pos: 'other', exampleSv: '', exampleEn: '', notes: '', tags: [],
  lessonNumber: null, lessonName: '', noun: null, verb: null, adjective: null, audioId: null, imageId: null, cardTypes: ['basic'],
});
const card = (id: string, at: number, patch: Partial<Card> = {}): Card => ({ ...meta(id, at), ...newSchedState(at), noteId: id, deckId: 'seed:deck:x', type: 'basic', suspended: false, leech: false, ...patch });
const log = (cardId: string, at: number): ReviewLog => ({ ...meta(`log-${seq++}`, at), cardId, noteId: cardId, deckId: 'seed:deck:x', rating: 3, state: CardState.New, reviewedAt: at, scheduledDays: 1, stability: 1, difficulty: 5, durationMs: 0, cram: false });

/** A device that has just seeded itself with the built-in content. */
async function freshDevice(name: string): Promise<FlashcardDB> {
  const d = new FlashcardDB(name);
  await d.delete();
  await d.open();
  await d.notes.bulkAdd([note('seed:hund', SEED_TIME), note('seed:katt', SEED_TIME + 1)]);
  await d.cards.bulkAdd([card('seed:hund', SEED_TIME), card('seed:katt', SEED_TIME + 1)]);
  return d;
}

let mac: FlashcardDB;
let phone: FlashcardDB;
let remote: FakeRemote;
beforeEach(async () => {
  mac = await freshDevice('mac');
  phone = await freshDevice('phone');
  remote = new FakeRemote();
});

describe('syncOnce', () => {
  it('does not upload untouched built-in content', async () => {
    const r = await syncOnce(mac, remote, T);
    expect(r).toEqual({ pulled: 0, applied: 0, pushed: 0 });
    expect(remote.rows.size).toBe(0);
  });

  it('carries progress from one device to the other, without duplicates', async () => {
    // study on the Mac
    await mac.cards.update('seed:hund', { state: CardState.Review, reps: 3, scheduledDays: 4, due: T + 4 * 864e5, updatedAt: T });
    await mac.reviews.add(log('seed:hund', T));
    expect(await syncOnce(mac, remote, T + 1000)).toMatchObject({ pushed: 2 });

    // the phone opens later, still a fresh copy
    const r = await syncOnce(phone, remote, T + 60_000);
    expect(r).toMatchObject({ pulled: 2, applied: 2 });
    expect(await phone.cards.get('seed:hund')).toMatchObject({ state: CardState.Review, reps: 3, scheduledDays: 4 });
    expect(await phone.cards.count()).toBe(2);
    expect(await phone.notes.count()).toBe(2);
    expect(await phone.reviews.count()).toBe(1);
    expect((await phone.cards.get('seed:katt'))!.state).toBe(CardState.New);
  });

  it('a fresh device never overwrites real progress with its untouched copy', async () => {
    await mac.cards.update('seed:hund', { state: CardState.Review, reps: 5, updatedAt: T });
    await syncOnce(mac, remote, T + 1000);
    await syncOnce(phone, remote, T + 2000);
    await syncOnce(mac, remote, T + 3000);
    expect((await mac.cards.get('seed:hund'))!.reps).toBe(5);
    expect((await phone.cards.get('seed:hund'))!.reps).toBe(5);
  });

  it('the latest change wins when both devices changed the same row', async () => {
    await mac.notes.update('seed:hund', { english: 'dog (mac)', updatedAt: T });
    await phone.notes.update('seed:hund', { english: 'dog (phone, later)', updatedAt: T + 5000 });
    await syncOnce(mac, remote, T + 6000);
    await syncOnce(phone, remote, T + 7000);
    await syncOnce(mac, remote, T + 8000);
    expect((await mac.notes.get('seed:hund'))!.english).toBe('dog (phone, later)');
    expect((await phone.notes.get('seed:hund'))!.english).toBe('dog (phone, later)');
  });

  it('new cards, deletes and settings all travel', async () => {
    await phone.notes.add(note('mine-1', T));
    await phone.cards.add(card('mine-1', T));
    await phone.notes.update('seed:katt', { deletedAt: T, updatedAt: T });
    await phone.kv.put({ key: 'settings', value: { ...DEFAULT_SETTINGS, newPerDay: 25 }, updatedAt: T });
    await phone.kv.put({ key: 'seeded', value: true, updatedAt: T });
    await syncOnce(phone, remote, T + 1000);
    await syncOnce(mac, remote, T + 2000);
    expect(await mac.notes.get('mine-1')).toBeTruthy();
    expect((await mac.notes.get('seed:katt'))!.deletedAt).toBe(T);
    expect(((await mac.kv.get('settings'))!.value as typeof DEFAULT_SETTINGS).newPerDay).toBe(25);
    expect([...remote.rows.keys()].some((k) => k.includes('seeded') || k.includes('sync'))).toBe(false); // per-device keys stay put
  });

  it('settles: a second round with nothing new sends nothing new to the server', async () => {
    await mac.cards.update('seed:hund', { reps: 2, updatedAt: T });
    await syncOnce(mac, remote, T + 1000);
    await syncOnce(phone, remote, T + 2000);
    const before = [...remote.rows.values()].map((r) => r.server_at).join();
    await syncOnce(phone, remote, T + 3000);
    await syncOnce(mac, remote, T + 4000);
    await syncOnce(phone, remote, T + 5000);
    expect([...remote.rows.values()].map((r) => r.server_at).join()).toBe(before);
    expect(await syncOnce(mac, remote, T + 6000)).toEqual({ pulled: 0, applied: 0, pushed: 0 });
  });

  it('still sends local edits after receiving rows from a device whose clock runs fast', async () => {
    const future = T + 3_600_000; // the phone thinks it is an hour later
    await phone.notes.update('seed:hund', { english: 'from the future', updatedAt: future });
    await syncOnce(phone, remote, future + 1000);
    await syncOnce(mac, remote, T + 1000); // receives the future row
    await syncOnce(mac, remote, T + 2000); // echoes it back
    await mac.notes.update('seed:katt', { english: 'edited on the mac', updatedAt: T + 3000 });
    await syncOnce(mac, remote, T + 4000);
    expect((remote.rows.get('notes/seed:katt')!.data as Note).english).toBe('edited on the mac');
  });

  it('after signing in again, everything is compared afresh', async () => {
    await mac.notes.update('seed:hund', { english: 'changed', updatedAt: T });
    await syncOnce(mac, remote, T + 1000);
    const other = new FakeRemote();
    await resetSyncCursors(mac);
    expect((await syncOnce(mac, other, T + 2000)).pushed).toBe(1);
  });
});

describe('the version 4 tables', () => {
  it('sync like the rest, and my seeded worksheet mistakes stay home until I answer one', async () => {
    const { SYNCED_TABLES } = await import('./engine');
    expect(SYNCED_TABLES).toEqual(expect.arrayContaining(['mistakeItems', 'checkpoints', 'lessons', 'hours']));
    const { db } = await import('../db/db');
    await Promise.all(db.tables.map((t) => t.clear()));
    const { addHours, recordWrong, seedMistakeItems } = await import('../db/repo');
    await seedMistakeItems([{ prompt: 'We lived in Denver.', typed: 'Vi borde i Denver.', correct: 'Vi bodde i Denver.', reason: '', tags: [], cardId: null, noteId: null, source: 'seed', timesWrong: 3 }]);
    const sent: { store: string; id: string }[] = [];
    const remote = { push: async (rows: { store: string; id: string }[]) => void sent.push(...rows), pull: async () => [] };
    await syncOnce(db, remote);
    expect(sent).toEqual([]);
    await recordWrong({ prompt: 'We lived in Denver.', typed: 'Vi bode i Denver.', correct: 'Vi bodde i Denver.', reason: '', tags: [], cardId: null, noteId: null, source: 'study' });
    await addHours({ date: '2026-11-23', category: 'speaking', minutes: 40 });
    await syncOnce(db, remote);
    expect(sent.map((r) => r.store).sort()).toEqual(['hours', 'mistakeItems']);
  });
});
