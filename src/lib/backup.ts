// CSV import/export of cards, and full JSON backup/restore of everything.

import { CHAT_KV } from './chat';
import { NEURAL_KV } from './neural';
import { db } from '../db/db';
import { alive, setKV } from '../db/repo';
import {
  DECK_CATEGORIES,
  GRAMMAR_KINDS,
  PARTS_OF_SPEECH,
  VOCAB_CARD_TYPES,
  emptyDraft,
  type Deck,
  type DeckCategory,
  type Draft,
  type GrammarKind,
  type Media,
  type Note,
  type PartOfSpeech,
  type SyncMeta,
  type VocabCardType,
} from '../db/types';
import type { DraftGroup } from './importer';
import { parseLine, parseTags } from './parser';

// ---------- CSV ----------

export const CSV_COLUMNS = [
  'deck',
  'section',
  'type',
  'swedish',
  'english',
  'part_of_speech',
  'gender',
  'definite',
  'plural',
  'infinitive',
  'present',
  'past',
  'supine',
  'adj_common',
  'adj_neuter',
  'adj_plural',
  'example_sv',
  'example_en',
  'notes',
  'tags',
  'prompt',
  'answer',
  'explanation',
  'card_types',
] as const;
type Column = (typeof CSV_COLUMNS)[number];

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCSV(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** RFC 4180 parser: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCSV(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function notesToCSV(notes: Note[], decks: Deck[]): string {
  const deckById = new Map(decks.map((d) => [d.id, d]));
  const rows: string[][] = [[...CSV_COLUMNS]];
  for (const n of notes) {
    const deck = deckById.get(n.deckId);
    const r: Record<Column, string> = {
      deck: deck?.name ?? '',
      section: deck?.category ?? 'vocab',
      type: n.kind,
      swedish: n.swedish,
      english: n.english,
      part_of_speech: n.kind === 'vocab' ? n.pos : '',
      gender: n.noun?.gender ?? '',
      definite: n.noun?.definite ?? '',
      plural: n.noun?.plural ?? '',
      infinitive: n.verb?.infinitive ?? '',
      present: n.verb?.present ?? '',
      past: n.verb?.past ?? '',
      supine: n.verb?.supine ?? '',
      adj_common: n.adjective?.common ?? '',
      adj_neuter: n.adjective?.neuter ?? '',
      adj_plural: n.adjective?.plural ?? '',
      example_sv: n.exampleSv,
      example_en: n.exampleEn,
      notes: n.notes,
      tags: n.tags.join(', '),
      prompt: n.grammar?.prompt ?? '',
      answer: n.grammar?.answer ?? '',
      explanation: n.grammar?.explanation ?? '',
      card_types: n.cardTypes.join(' '),
    };
    rows.push(CSV_COLUMNS.map((c) => r[c]));
  }
  return toCSV(rows);
}

export interface CsvImport {
  groups: DraftGroup[];
  errors: { line: number; raw: string; error: string }[];
}

const HEADER_ALIASES: Record<string, Column> = {
  svenska: 'swedish',
  sv: 'swedish',
  word: 'swedish',
  front: 'swedish',
  engelska: 'english',
  en: 'english',
  meaning: 'english',
  translation: 'english',
  back: 'english',
  pos: 'part_of_speech',
  kind: 'type',
  category: 'section',
  example: 'example_sv',
  note: 'notes',
  tag: 'tags',
};

function rowToDraft(get: (c: Column) => string): Draft | string {
  const type = get('type').toLowerCase();
  if ((GRAMMAR_KINDS as string[]).includes(type)) {
    if (!get('prompt') || !get('answer')) return 'A grammar card needs a prompt and an answer.';
    const d = emptyDraft(type as GrammarKind);
    d.grammar = { prompt: get('prompt'), answer: get('answer'), explanation: get('explanation'), topic: null };
    d.tags = parseTags(get('tags'));
    return d;
  }
  if (!get('swedish') || !get('english')) return 'Needs at least a Swedish word and an English meaning.';
  const d = emptyDraft('vocab');
  d.swedish = get('swedish');
  d.english = get('english');
  const pos = get('part_of_speech').toLowerCase();
  const gender = get('gender').toLowerCase();
  if (gender === 'en' || gender === 'ett' || get('definite') || get('plural'))
    d.noun = { gender: gender === 'en' || gender === 'ett' ? gender : null, definite: get('definite'), plural: get('plural') };
  if (get('present') || get('past') || get('supine'))
    d.verb = { infinitive: get('infinitive') || d.swedish, present: get('present'), past: get('past'), supine: get('supine') };
  if (get('adj_neuter') || get('adj_plural'))
    d.adjective = { common: get('adj_common') || d.swedish, neuter: get('adj_neuter'), plural: get('adj_plural') };
  d.pos = (PARTS_OF_SPEECH as string[]).includes(pos)
    ? (pos as PartOfSpeech)
    : d.noun
      ? 'noun'
      : d.verb
        ? 'verb'
        : d.adjective
          ? 'adjective'
          : /\s/.test(d.swedish)
            ? 'phrase'
            : 'other';
  d.exampleSv = get('example_sv');
  d.exampleEn = get('example_en');
  d.notes = get('notes');
  d.tags = parseTags(get('tags'));
  return d;
}

/**
 * Read a CSV into import groups. With a header row, columns are matched by
 * name (this app's export, or simple "swedish,english,..." sheets). Without a
 * header, columns are read in lesson order: Swedish, English, forms, example, tags.
 */
export function csvToGroups(text: string, fallbackDeck: string): CsvImport {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows = parseCSV(text, delimiter);
  const errors: CsvImport['errors'] = [];
  const groups = new Map<string, DraftGroup>();
  const add = (deck: string, category: DeckCategory, draft: Draft, cardTypes: VocabCardType[] | undefined, line: number) => {
    const name = deck.trim() || fallbackDeck;
    if (!groups.has(name)) groups.set(name, { deck: { name, category, cardTypes }, items: [] });
    groups.get(name)!.items.push({ draft, line });
  };
  if (rows.length === 0) return { groups: [], errors };

  const header = rows[0].map((h) => {
    const k = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ((CSV_COLUMNS as readonly string[]).includes(k) ? k : HEADER_ALIASES[k]) as Column | undefined;
  });
  const hasHeader = header.includes('swedish') || header.includes('prompt');

  rows.slice(hasHeader ? 1 : 0).forEach((row, i) => {
    const line = i + (hasHeader ? 2 : 1);
    if (!hasHeader) {
      const r = parseLine(row.join(' | '));
      if (r.draft) add('', r.draft.kind === 'vocab' ? 'vocab' : 'grammar', r.draft, undefined, line);
      else errors.push({ line, raw: row.join(', '), error: r.error ?? 'Could not read this row.' });
      return;
    }
    const get = (c: Column) => (row[header.indexOf(c)] ?? '').trim();
    const draft = rowToDraft(get);
    if (typeof draft === 'string') {
      errors.push({ line, raw: row.join(', '), error: draft });
      return;
    }
    const section = get('section').toLowerCase();
    const category = (DECK_CATEGORIES as string[]).includes(section)
      ? (section as DeckCategory)
      : draft.kind === 'vocab'
        ? 'vocab'
        : 'grammar';
    const types = get('card_types')
      .split(/[\s,]+/)
      .filter((t): t is VocabCardType => (VOCAB_CARD_TYPES as string[]).includes(t));
    add(get('deck'), category, draft, types.length ? types : undefined, line);
  });
  return { groups: [...groups.values()], errors };
}

// ---------- JSON backup ----------

export const BACKUP_APP = 'svenska-kort';
export const BACKUP_VERSION = 1;
const SYNCED_TABLES = ['decks', 'notes', 'cards', 'reviews', 'grammarPages', 'mistakes', 'texts', 'journal'] as const;

type MediaJSON = Omit<Media, 'blob'> & { data: string };

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  tables: Record<(typeof SYNCED_TABLES)[number], SyncMeta[]> & { media: MediaJSON[]; kv: { key: string; value: unknown; updatedAt: number }[] };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Everything in the database, tombstones and review history included. */
export async function exportBackup(): Promise<Backup> {
  const tables = {} as Backup['tables'];
  for (const t of SYNCED_TABLES) tables[t] = (await db.table(t).toArray()) as SyncMeta[];
  tables.media = await Promise.all(
    (await db.media.toArray()).map(async ({ blob, ...rest }) => ({ ...rest, data: await blobToBase64(blob) })),
  );
  // Sign-in tokens, sync bookkeeping, the speech key and the chat key never go into a backup file.
  tables.kv = (await db.kv.toArray()).filter((r) => !r.key.startsWith('sync') && r.key !== NEURAL_KV && r.key !== CHAT_KV);
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables };
}

export function validateBackup(data: unknown): Backup {
  const b = data as Partial<Backup> | null;
  if (!b || typeof b !== 'object' || b.app !== BACKUP_APP || !b.tables)
    throw new Error('This file is not a Svenska Kort backup.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION)
    throw new Error('This backup was made by a newer version of the app.');
  for (const t of SYNCED_TABLES) if (!Array.isArray(b.tables[t] ?? [])) throw new Error(`Backup is damaged (${t}).`);
  return b as Backup;
}

export interface RestoreSummary {
  decks: number;
  notes: number;
  cards: number;
  reviews: number;
}

/**
 * 'replace' wipes the database and loads the backup.
 * 'merge' keeps what is here and takes each row from whichever side changed it
 * last (the same rule a sync backend would use).
 */
export async function restoreBackup(data: unknown, mode: 'replace' | 'merge'): Promise<RestoreSummary> {
  const backup = validateBackup(data);
  const media: Media[] = (backup.tables.media ?? []).map(({ data: d, ...rest }) => ({ ...rest, blob: base64ToBlob(d, rest.mime) }));
  await db.transaction('rw', db.tables, async () => {
    if (mode === 'replace') {
      // The speech key, the chat key and the saved voice clips belong to this device, not to the backup.
      const speech = await db.kv.get(NEURAL_KV);
      const chatKey = await db.kv.get(CHAT_KV);
      await Promise.all(db.tables.filter((t) => t.name !== 'tts').map((t) => t.clear()));
      if (speech) await db.kv.put(speech);
      if (chatKey) await db.kv.put(chatKey);
    }
    const put = async (name: string, rows: SyncMeta[]) => {
      const table = db.table(name);
      if (mode === 'replace') return void (await table.bulkPut(rows));
      for (const row of rows) {
        const mine = (await table.get(row.id)) as SyncMeta | undefined;
        if (!mine || row.updatedAt > mine.updatedAt) await table.put(row);
      }
    };
    for (const t of SYNCED_TABLES) await put(t, backup.tables[t] ?? []);
    await put('media', media);
    for (const row of backup.tables.kv ?? []) {
      if (row.key === NEURAL_KV || row.key === CHAT_KV) continue;
      const mine = await db.kv.get(row.key);
      if (mode === 'replace' || !mine || row.updatedAt > mine.updatedAt) await db.kv.put(row);
    }
  });
  const count = (t: (typeof SYNCED_TABLES)[number]) => alive(backup.tables[t] ?? []).length;
  return { decks: count('decks'), notes: count('notes'), cards: count('cards'), reviews: count('reviews') };
}

// ---------- browser helpers ----------

export function downloadFile(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const dateStamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function downloadBackup(): Promise<void> {
  downloadFile(`svenska-kort-backup-${dateStamp()}.json`, JSON.stringify(await exportBackup()), 'application/json');
  await setKV('lastBackupAt', Date.now());
}
