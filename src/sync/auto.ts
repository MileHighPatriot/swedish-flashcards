// Keeps this device in step with the others: syncs when the app opens, a few
// seconds after anything changes, when it comes back to the front, when the
// network returns, and every few minutes while it is open.

import Dexie from 'dexie';
import { useEffect, useSyncExternalStore } from 'react';
import { db } from '../db/db';
import { resetSyncCursors, syncOnce } from './engine';
import { SupabaseRemote, currentEmail, getClient, signIn, signOut, signUp, syncConfigured } from './supabase';

export interface SyncStatus {
  configured: boolean;
  email: string | null;
  state: 'idle' | 'syncing' | 'error';
  lastSyncedAt: number | null;
  error: string | null;
}

let status: SyncStatus = { configured: syncConfigured, email: null, state: 'idle', lastSyncedAt: null, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
};

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

let running: Promise<void> | null = null;
let quietUntil = 0;

/** Sync now. Calls made while a round is running wait for that round. */
export function syncNow(): Promise<void> {
  if (!syncConfigured || !status.email) return Promise.resolve();
  running ??= (async () => {
    set({ state: 'syncing', error: null });
    try {
      await syncOnce(db, new SupabaseRemote(await getClient()));
      set({ state: 'idle', lastSyncedAt: Date.now() });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ state: 'error', error: navigator.onLine ? message : 'Offline. Your changes are saved here and will sync when you are back online.' });
    } finally {
      // Our own writes also fire change events; ignore them for a moment.
      quietUntil = Date.now() + 1500;
      running = null;
    }
  })();
  return running;
}

export async function signInAndSync(email: string, password: string, create: boolean): Promise<'ok' | 'confirm-email'> {
  if (create) {
    if (!(await signUp(email, password))) return 'confirm-email';
  } else await signIn(email, password);
  // A different account may have used this device before: compare everything afresh.
  await resetSyncCursors(db);
  set({ email: await currentEmail() });
  await syncNow();
  return 'ok';
}

export async function signOutOfSync(): Promise<void> {
  await signOut();
  await resetSyncCursors(db);
  set({ email: null, lastSyncedAt: null, error: null, state: 'idle' });
}

/** Mount once, at the top of the app. */
export function useAutoSync(): void {
  useEffect(() => {
    if (!syncConfigured) return;
    let timer = 0;
    const soon = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void syncNow(), ms);
    };
    void currentEmail().then((email) => {
      set({ email });
      if (email) void syncNow();
    });
    const onChange = () => {
      if (running || Date.now() < quietUntil) return;
      soon(4000);
    };
    const onVisible = () => document.visibilityState === 'visible' && soon(300);
    const onOnline = () => soon(300);
    Dexie.on('storagemutated', onChange);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const every = window.setInterval(() => void syncNow(), 3 * 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(every);
      Dexie.on('storagemutated').unsubscribe(onChange);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, []);
}
