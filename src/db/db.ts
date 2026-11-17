import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Card, Deck, GrammarPage, JournalEntry, KeyValue, Media, Mistake, Note, ReviewLog, TextDoc, TtsClip } from './types';

// The Dexie schema. Only `repo.ts` (and backup/import code) should touch these
// tables directly, so that every write gets stamped and a sync layer has one
// place to hook into.
export class FlashcardDB extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  reviews!: EntityTable<ReviewLog, 'id'>;
  media!: EntityTable<Media, 'id'>;
  grammarPages!: EntityTable<GrammarPage, 'id'>;
  mistakes!: EntityTable<Mistake, 'id'>;
  texts!: EntityTable<TextDoc, 'id'>;
  journal!: EntityTable<JournalEntry, 'id'>;
  kv!: Table<KeyValue, string>;
  /** Saved clips of the natural voice. Per device: never synced or backed up. */
  tts!: Table<TtsClip, string>;

  constructor(name = 'svenska-kort') {
    super(name);
    this.version(1).stores({
      decks: 'id, name, updatedAt',
      notes: 'id, deckId, swedish, *tags, updatedAt',
      cards: 'id, noteId, deckId, due, state, updatedAt',
      reviews: 'id, cardId, reviewedAt, updatedAt',
      media: 'id, updatedAt',
      grammarPages: 'id, slug, updatedAt',
      mistakes: 'id, cardId, at, updatedAt',
      kv: 'key',
    });
    this.version(2).stores({ tts: 'key' });
    // Practice tools: my own reading texts and the daily journal.
    this.version(3).stores({ texts: 'id, updatedAt', journal: 'id, date, updatedAt' });
  }
}

export const db = new FlashcardDB();
