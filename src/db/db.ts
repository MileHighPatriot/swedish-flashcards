import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Card, Checkpoint, Deck, GrammarPage, HoursEntry, JournalEntry, KeyValue, Lesson, Media, Mistake, MistakeItem, Note, ReviewLog, TextDoc, TtsClip } from './types';

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
  mistakeItems!: EntityTable<MistakeItem, 'id'>;
  checkpoints!: EntityTable<Checkpoint, 'id'>;
  lessons!: EntityTable<Lesson, 'id'>;
  hours!: EntityTable<HoursEntry, 'id'>;
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
    // The B2 plan: things to fix, checkpoint results, imported lessons and the hours log.
    // Only new tables: nothing that already exists is touched, so no upgrade step is needed.
    this.version(4).stores({
      mistakeItems: 'id, key, updatedAt',
      checkpoints: 'id, cp, at, updatedAt',
      lessons: 'id, number, updatedAt',
      hours: 'id, date, updatedAt',
    });
  }
}

export const db = new FlashcardDB();
