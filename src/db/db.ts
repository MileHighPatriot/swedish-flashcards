import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Card, Deck, GrammarPage, KeyValue, Media, Mistake, Note, ReviewLog } from './types';

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
  kv!: Table<KeyValue, string>;

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
  }
}

export const db = new FlashcardDB();
