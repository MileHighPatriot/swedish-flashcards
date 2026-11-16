// The Supabase side of sync: sign-in and the Remote the engine talks to.

import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '../db/db';
import type { OutgoingRow, Remote, RemoteRow } from './engine';

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const key: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False in a build made without the sync address; the app then works on one device only. */
export const syncConfigured = Boolean(url && key);

const SESSION_KEY = 'syncSession';
const TABLE = 'svenska_records';
const PUSH_BATCH = 400;
const PAGE = 1000;

/**
 * The sign-in is kept in this app's own database rather than localStorage:
 * other sites on the same web address could read anything left there.
 */
const sessionStore = {
  async read(): Promise<Record<string, string>> {
    return ((await db.kv.get(SESSION_KEY))?.value as Record<string, string> | undefined) ?? {};
  },
  async getItem(name: string) {
    return (await this.read())[name] ?? null;
  },
  async setItem(name: string, value: string) {
    await db.kv.put({ key: SESSION_KEY, value: { ...(await this.read()), [name]: value }, updatedAt: Date.now() });
  },
  async removeItem(name: string) {
    const all = await this.read();
    delete all[name];
    await db.kv.put({ key: SESSION_KEY, value: all, updatedAt: Date.now() });
  },
};

let client: Promise<SupabaseClient> | null = null;

/** Loaded only when sync is set up, so the library stays out of the way otherwise. */
export function getClient(): Promise<SupabaseClient> {
  if (!url || !key) return Promise.reject(new Error('Sync is not set up in this copy of the app.'));
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, key, {
      auth: { storage: sessionStore, storageKey: 'svenska-kort-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    }),
  );
  return client;
}

export class SupabaseRemote implements Remote {
  constructor(private supabase: SupabaseClient) {}

  async push(rows: OutgoingRow[]): Promise<void> {
    for (let i = 0; i < rows.length; i += PUSH_BATCH) {
      const { error } = await this.supabase.rpc('svenska_push_records', { rows: rows.slice(i, i + PUSH_BATCH) });
      if (error) throw new Error(error.message);
    }
  }

  async pull(since: string | null): Promise<RemoteRow[]> {
    const out: RemoteRow[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.supabase.from(TABLE).select('store,id,updated_at,deleted,data,server_at').order('server_at').order('id').range(from, from + PAGE - 1);
      if (since) q = q.gt('server_at', since);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as RemoteRow[]));
      if (!data || data.length < PAGE) return out;
    }
  }
}

export async function currentEmail(): Promise<string | null> {
  if (!syncConfigured) return null;
  const { data } = await (await getClient()).auth.getSession();
  return data.session?.user.email ?? null;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await (await getClient()).auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

/** Returns true if the account is ready, false if Supabase wants the email confirmed first. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await (await getClient()).auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return Boolean(data.session);
}

export async function signOut(): Promise<void> {
  await (await getClient()).auth.signOut();
}
