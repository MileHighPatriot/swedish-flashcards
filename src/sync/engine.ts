// Sync engine. Knows nothing about Supabase: it talks to a `Remote`, so it can
// be tested against a fake one and pointed at another backend later.
//
// The rule is "last change wins", per row, by the row's own updatedAt.
// Deletes are tombstones (deletedAt), so they travel like any other change.

import type { FlashcardDB } from '../db/db';
import { SEED_TIME } from '../db/repo';
import type { SyncMeta } from '../db/types';

/** Tables that sync. Recordings (media) stay on the device they were added on. */
export const SYNCED_TABLES = ['decks', 'notes', 'cards', 'reviews', 'grammarPages', 'mistakes', 'texts', 'journal'] as const;
/** The one key/value row that syncs: settings. Everything else in kv is per device. */
const KV_STORE = 'kv';
const SYNCED_KV = ['settings'];

export interface OutgoingRow {
  store: string;
  id: string;
  /** ISO time the row last changed on a device. */
  updated_at: string;
  deleted: boolean;
  data: unknown;
}

export interface RemoteRow extends OutgoingRow {
  /** ISO time the server accepted the row; the pull cursor. */
  server_at: string;
}

export interface Remote {
  /** Send rows. The server keeps a row only if it is newer than what it has. */
  push(rows: OutgoingRow[]): Promise<void>;
  /** Rows the server accepted after `since` (null = everything), oldest first. */
  pull(since: string | null): Promise<RemoteRow[]>;
}

export interface SyncResult {
  pulled: number;
  applied: number;
  pushed: number;
}

const PULLED_KEY = 'syncPulledAt';
const PUSHED_KEY = 'syncPushedAt';
/** Built-in rows are stamped inside this window and are identical everywhere: never uploaded. */
const SEED_END = SEED_TIME + 1_000_000;

async function applyRemote(db: FlashcardDB, row: RemoteRow): Promise<boolean> {
  const remoteTime = Date.parse(row.updated_at);
  if (row.store === KV_STORE) {
    if (!SYNCED_KV.includes(row.id)) return false;
    const mine = await db.kv.get(row.id);
    if (mine && mine.updatedAt >= remoteTime) return false;
    await db.kv.put({ key: row.id, value: (row.data as { value: unknown }).value, updatedAt: remoteTime });
    return true;
  }
  if (!(SYNCED_TABLES as readonly string[]).includes(row.store)) return false;
  const table = db.table<SyncMeta, string>(row.store);
  const mine = await table.get(row.id);
  if (mine && mine.updatedAt >= remoteTime) return false;
  await table.put(row.data as SyncMeta);
  return true;
}

async function changedSince(db: FlashcardDB, cursor: number): Promise<OutgoingRow[]> {
  const from = Math.max(cursor, SEED_END);
  const out: OutgoingRow[] = [];
  for (const name of SYNCED_TABLES) {
    const rows = await db.table<SyncMeta, string>(name).where('updatedAt').above(from).toArray();
    for (const r of rows) out.push({ store: name, id: r.id, updated_at: new Date(r.updatedAt).toISOString(), deleted: r.deletedAt != null, data: r });
  }
  for (const key of SYNCED_KV) {
    const row = await db.kv.get(key);
    if (row && row.updatedAt > from) out.push({ store: KV_STORE, id: key, updated_at: new Date(row.updatedAt).toISOString(), deleted: false, data: { value: row.value } });
  }
  return out;
}

/** One round: take what is new on the server, then send what is new here. */
export async function syncOnce(db: FlashcardDB, remote: Remote, now = Date.now()): Promise<SyncResult> {
  const pulledAt = ((await db.kv.get(PULLED_KEY))?.value as string | undefined) ?? null;
  const incoming = await remote.pull(pulledAt);
  let applied = 0;
  for (const row of incoming) if (await applyRemote(db, row)) applied++;
  if (incoming.length) await db.kv.put({ key: PULLED_KEY, value: incoming[incoming.length - 1].server_at, updatedAt: now });

  const pushedAt = ((await db.kv.get(PUSHED_KEY))?.value as number | undefined) ?? 0;
  const outgoing = await changedSince(db, pushedAt);
  if (outgoing.length) {
    await remote.push(outgoing);
    // Never move the cursor past this device's own clock: a row that arrived from a
    // device whose clock runs fast must not hide this device's later edits.
    const newest = Math.max(...outgoing.map((r) => Date.parse(r.updated_at)));
    await db.kv.put({ key: PUSHED_KEY, value: Math.max(pushedAt, Math.min(newest, now)), updatedAt: now });
  }
  return { pulled: incoming.length, applied, pushed: outgoing.length };
}

/** Forget the cursors, e.g. after signing in, so the next round compares everything. */
export async function resetSyncCursors(db: FlashcardDB): Promise<void> {
  await db.kv.bulkDelete([PULLED_KEY, PUSHED_KEY]);
}
