// Natural Swedish voice from Azure Speech. Each clip is fetched once, saved on
// this device (the `tts` table) and played from there afterwards, so it works
// offline. The key is typed into Settings and stays on the device: it is never
// built into the app, synced, or written to a backup file.

import { useEffect, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Note } from '../db/types';
import { splitAlternatives } from './parser';

export interface NeuralConfig {
  key: string;
  region: string;
  voice: string;
}

export const NEURAL_KV = 'azureSpeech';

export const NEURAL_VOICES = [
  { id: 'sv-SE-SofieNeural', label: 'Sofie (female)' },
  { id: 'sv-SE-HilleviNeural', label: 'Hillevi (female)' },
  { id: 'sv-SE-MattiasNeural', label: 'Mattias (male)' },
] as const;
export const DEFAULT_NEURAL_VOICE = NEURAL_VOICES[0].id;
export const DEFAULT_NEURAL_REGION = 'westus2';

/** The free tier allows 20 requests a minute; stay a little under it. */
export const MAX_PER_MINUTE = 16;
const BACKGROUND_PER_MINUTE = 12;
const MIME = 'audio/mpeg';

// ---------- pure helpers ----------

export const cleanText = (text: string): string => text.normalize('NFC').replace(/\s+/g, ' ').trim();

export const clipKey = (voice: string, text: string): string => `${voice}|${cleanText(text)}`;

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function ssml(voice: string, text: string): string {
  return `<speak version='1.0' xml:lang='sv-SE'><voice name='${xml(voice)}'>${xml(cleanText(text))}</voice></speak>`;
}

/** Every piece of Swedish the cards can play aloud, without repeats. */
export function spokenTexts(notes: Pick<Note, 'swedish' | 'exampleSv' | 'kind' | 'grammar' | 'audioId' | 'deletedAt'>[]): string[] {
  const out = new Set<string>();
  const add = (t: string | undefined) => {
    const c = cleanText(t ?? '');
    if (c) out.add(c);
  };
  for (const n of notes) {
    if (n.deletedAt != null) continue;
    if (n.grammar) {
      if (n.kind !== 'rule') add(splitAlternatives(n.grammar.answer)[0]);
      continue;
    }
    if (!n.audioId) add(n.swedish);
    add(n.exampleSv);
  }
  return [...out];
}

// ---------- configuration ----------

let config: NeuralConfig | null = null;

export const neuralEnabled = (): boolean => config != null;
export const neuralConfig = (): NeuralConfig | null => config;

export async function loadNeural(): Promise<NeuralConfig | null> {
  const v = (await db.kv.get(NEURAL_KV))?.value as Partial<NeuralConfig> | undefined;
  config = v?.key && v.region ? { key: v.key, region: v.region, voice: v.voice || DEFAULT_NEURAL_VOICE } : null;
  setStatus({ enabled: config != null, error: null });
  return config;
}

export async function saveNeural(next: NeuralConfig | null): Promise<void> {
  if (next) await db.kv.put({ key: NEURAL_KV, value: next, updatedAt: Date.now() });
  else await db.kv.delete(NEURAL_KV);
  config = next;
  setStatus({ enabled: next != null, error: null });
  void prefetch();
}

/** Delete every saved clip (they are fetched again when needed). */
export async function clearClips(): Promise<void> {
  await db.tts.clear();
  void prefetch();
}

// ---------- status for the settings screen ----------

export interface NeuralStatus {
  enabled: boolean;
  ready: number;
  total: number;
  running: boolean;
  error: string | null;
}

let status: NeuralStatus = { enabled: false, ready: 0, total: 0, running: false, error: null };
const listeners = new Set<() => void>();
function setStatus(patch: Partial<NeuralStatus>): void {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}
export function useNeuralStatus(): NeuralStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

// ---------- fetching ----------

export class NeuralError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const describe = (httpStatus: number): string =>
  httpStatus === 401 || httpStatus === 403
    ? 'Azure did not accept the key. Check the key and the region.'
    : httpStatus === 429
      ? 'Azure is busy or the free allowance is used up. It will try again later.'
      : `Azure answered with an error (${httpStatus}).`;

/** Ask Azure for one clip. Does not touch the saved clips. */
export async function requestClip(cfg: NeuralConfig, text: string): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(`https://${encodeURIComponent(cfg.region.trim())}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': cfg.key.trim(),
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      },
      body: ssml(cfg.voice, text),
    });
  } catch {
    throw new NeuralError(0, 'Could not reach Azure. Check the region and your connection.');
  }
  if (!res.ok) throw new NeuralError(res.status, describe(res.status));
  const data = await res.arrayBuffer();
  if (data.byteLength === 0) throw new NeuralError(res.status, 'Azure sent back an empty clip.');
  return data;
}

let recent: number[] = [];
/** Take a slot under the per-minute limit, or say how long to wait (ms). */
export function takeSlot(now = Date.now(), limit = MAX_PER_MINUTE): number {
  recent = recent.filter((t) => now - t < 60_000);
  if (recent.length >= limit) return 60_000 - (now - recent[0]) + 50;
  recent.push(now);
  return 0;
}
export function resetSlots(): void {
  recent = [];
}

export interface Clip {
  data: ArrayBuffer;
  mime: string;
}

const inFlight = new Map<string, Promise<Clip>>();

async function fetchAndStore(cfg: NeuralConfig, text: string): Promise<Clip> {
  const key = clipKey(cfg.voice, text);
  const running = inFlight.get(key);
  if (running) return running;
  const p = (async () => {
    const data = await requestClip(cfg, text);
    await db.tts.put({ key, data, mime: MIME, at: Date.now() });
    return { data, mime: MIME };
  })();
  inFlight.set(key, p);
  try {
    return await p;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * The clip for this text: from this device if it is saved, otherwise from
 * Azure (when online and under the rate limit). Null means "use the system voice".
 */
export async function getClip(text: string): Promise<Clip | null> {
  const cfg = config;
  if (!cfg || !cleanText(text)) return null;
  const saved = await db.tts.get(clipKey(cfg.voice, text));
  if (saved) return { data: saved.data, mime: saved.mime };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  if (takeSlot() > 0) return null;
  try {
    return await fetchAndStore(cfg, text);
  } catch {
    return null;
  }
}

// ---------- background download ----------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let runId = 0;

/** Texts that still need a clip, and how many there are in all. */
export async function missingClips(cfg: NeuralConfig): Promise<{ missing: string[]; total: number }> {
  const texts = spokenTexts(await db.notes.toArray());
  const have = new Set((await db.tts.toCollection().primaryKeys()) as string[]);
  return { missing: texts.filter((t) => !have.has(clipKey(cfg.voice, t))), total: texts.length };
}

/**
 * Fetch every missing clip, slowly enough for the free tier. Safe to call
 * again at any time: a new call replaces the one that is running.
 */
export async function prefetch(wait: (ms: number) => Promise<void> = sleep): Promise<void> {
  const id = ++runId;
  const cfg = config;
  if (!cfg) return setStatus({ running: false, ready: 0, total: 0 });
  const { missing, total } = await missingClips(cfg);
  if (id !== runId) return;
  let ready = total - missing.length;
  setStatus({ ready, total, running: missing.length > 0 });
  for (const text of missing) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
    // Leave a few requests a minute free for cards being played right now.
    for (let w = takeSlot(Date.now(), BACKGROUND_PER_MINUTE); w > 0; w = takeSlot(Date.now(), BACKGROUND_PER_MINUTE)) {
      await wait(w);
      if (id !== runId) return;
    }
    try {
      await fetchAndStore(cfg, text);
      if (id !== runId) return;
      setStatus({ ready: ++ready, error: null });
    } catch (e) {
      if (id !== runId) return;
      const err = e instanceof NeuralError ? e : new NeuralError(0, 'Could not fetch a clip.');
      setStatus({ error: err.message });
      // A rejected key or no connection will not fix itself; a busy server might.
      if (err.status !== 429) break;
      await wait(60_000);
      if (id !== runId) return;
    }
  }
  if (id === runId) setStatus({ running: false });
}

/** Keeps the saved clips up to date while the app is open. */
export function useNeuralPrefetch(): void {
  // Re-check whenever cards are added, edited or arrive from another device.
  const stamp = useLiveQuery(async () => {
    const last = await db.notes.orderBy('updatedAt').last();
    return `${await db.notes.count()}:${last?.updatedAt ?? 0}`;
  }, []);
  useEffect(() => {
    if (stamp === undefined) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void loadNeural().then(() => {
        if (!cancelled) void prefetch();
      });
    }, 1500);
    const online = () => void prefetch();
    window.addEventListener('online', online);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.removeEventListener('online', online);
    };
  }, [stamp]);
}
