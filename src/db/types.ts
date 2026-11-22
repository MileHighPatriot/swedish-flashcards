// Data model. Every row carries SyncMeta (UUID id, timestamps, tombstone) so a
// sync backend can be added later by diffing on `updatedAt` without a rewrite.
// All dates are epoch milliseconds: indexable in IndexedDB and JSON-safe.

export type ID = string;

export interface SyncMeta {
  id: ID;
  createdAt: number;
  updatedAt: number;
  /** Soft delete. Rows are tombstoned, never removed, so deletes can sync. */
  deletedAt: number | null;
}

export type PartOfSpeech =
  | 'noun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'pronoun'
  | 'preposition'
  | 'conjunction'
  | 'numeral'
  | 'interjection'
  | 'phrase'
  | 'other';

export const PARTS_OF_SPEECH: PartOfSpeech[] = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'numeral',
  'interjection',
  'phrase',
  'other',
];

export type Gender = 'en' | 'ett';

export interface NounForms {
  gender: Gender | null;
  /** e.g. "hunden" */
  definite: string;
  /** e.g. "hundar" */
  plural: string;
}

export interface VerbForms {
  infinitive: string;
  present: string;
  past: string;
  supine: string;
}

export interface AdjectiveForms {
  /** en-form, e.g. "stor" */
  common: string;
  /** ett-form, e.g. "stort" */
  neuter: string;
  /** plural/definite, e.g. "stora" */
  plural: string;
}

/** Card types a vocabulary note can have (any combination, 'basic' always). */
export type VocabCardType = 'basic' | 'reverse' | 'cloze' | 'typed' | 'listening';
/** Grammar notes have exactly one card, of the same type as the note's kind. */
export type GrammarKind = 'rule' | 'fix' | 'reorder' | 'translate';
export type CardType = VocabCardType | GrammarKind;
export type NoteKind = 'vocab' | GrammarKind;

export const VOCAB_CARD_TYPES: VocabCardType[] = ['basic', 'reverse', 'cloze', 'typed', 'listening'];
export const GRAMMAR_KINDS: GrammarKind[] = ['rule', 'fix', 'reorder', 'translate'];

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  basic: 'Swedish → English',
  reverse: 'English → Swedish',
  cloze: 'Fill in the blank',
  typed: 'Type the Swedish',
  listening: 'Listening',
  rule: 'Grammar rule',
  fix: 'Fix the error',
  reorder: 'Reorder the words',
  translate: 'Translate to Swedish',
};

/**
 * Content of a grammar card, as written in a lesson:
 *   type | prompt | answer | explanation | tags
 * `answer` may hold several accepted answers separated by " // ".
 * For reorder cards `prompt` holds the scrambled chunks separated by " / ".
 */
export interface GrammarContent {
  prompt: string;
  answer: string;
  explanation: string;
  /** Slug of the grammar notes page behind "Review the rule", if any. */
  topic: string | null;
}

/** The three sections of the app. Every deck belongs to one. */
export type DeckCategory = 'vocab' | 'grammar' | 'phrases';
export const DECK_CATEGORIES: DeckCategory[] = ['vocab', 'grammar', 'phrases'];
export const CATEGORY_LABELS: Record<DeckCategory, string> = {
  vocab: 'Vocabulary',
  grammar: 'Grammar',
  phrases: 'Phrases',
};

export interface Deck extends SyncMeta {
  name: string;
  category: DeckCategory;
  lessonNumber: number | null;
  lessonName: string;
  description: string;
  /** A "coming soon" deck: its cards stay suspended until the deck is unlocked. */
  locked: boolean;
}

/**
 * A Note is one vocabulary entry (what the UI calls a "word"). It owns the
 * content. Each enabled card type becomes one sibling Card that is scheduled
 * on its own.
 */
export interface Note extends SyncMeta {
  deckId: ID;
  kind: NoteKind;
  /** Set for grammar notes (kind !== 'vocab'), null for vocabulary. */
  grammar: GrammarContent | null;
  swedish: string;
  english: string;
  pos: PartOfSpeech;
  exampleSv: string;
  exampleEn: string;
  notes: string;
  tags: string[];
  lessonNumber: number | null;
  lessonName: string;
  noun: NounForms | null;
  verb: VerbForms | null;
  adjective: AdjectiveForms | null;
  /** Row id in the media table, if a recording/image is attached. */
  audioId: ID | null;
  imageId: ID | null;
  /** Which sibling cards exist. Vocab always has 'basic'; grammar notes have just [kind]. */
  cardTypes: CardType[];
}

/** The content of a note before it has a deck: what the parser and the editor work on. */
export type Draft = Pick<
  Note,
  'kind' | 'grammar' | 'swedish' | 'english' | 'pos' | 'exampleSv' | 'exampleEn' | 'notes' | 'tags' | 'noun' | 'verb' | 'adjective'
>;

export function emptyDraft(kind: NoteKind = 'vocab'): Draft {
  return {
    kind,
    grammar: kind === 'vocab' ? null : { prompt: '', answer: '', explanation: '', topic: null },
    swedish: '',
    english: '',
    pos: 'other',
    exampleSv: '',
    exampleEn: '',
    notes: '',
    tags: [],
    noun: null,
    verb: null,
    adjective: null,
  };
}

/** FSRS card states, matching ts-fsrs `State`. */
export const CardState = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
export type CardStateValue = (typeof CardState)[keyof typeof CardState];

/** The scheduling fields of a card, independent of content. */
export interface SchedState {
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: CardStateValue;
  lastReview: number | null;
}

export interface Card extends SyncMeta, SchedState {
  noteId: ID;
  /** Denormalised from the note so per-deck queues are one indexed query. */
  deckId: ID;
  type: CardType;
  suspended: boolean;
  leech: boolean;
}

/** 1 Again, 2 Hard, 3 Good, 4 Easy. Matches ts-fsrs `Rating`. */
export type Grade = 1 | 2 | 3 | 4;

export interface ReviewLog extends SyncMeta {
  cardId: ID;
  noteId: ID;
  deckId: ID;
  rating: Grade;
  /** Card state before this review. */
  state: CardStateValue;
  reviewedAt: number;
  /** Interval that was scheduled by this review, in days. */
  scheduledDays: number;
  stability: number;
  difficulty: number;
  /** Time spent on the card. */
  durationMs: number;
  /** Cram reviews are logged for the heatmap but never change scheduling. */
  cram: boolean;
}

/** One saved clip of the natural voice, keyed by "voice|text". */
export interface TtsClip {
  key: string;
  data: ArrayBuffer;
  mime: string;
  at: number;
}

export interface Media extends SyncMeta {
  kind: 'audio' | 'image';
  mime: string;
  blob: Blob;
}

/** An editable page in the grammar notes library. */
export interface GrammarPage extends SyncMeta {
  /** Stable key that cards link to, e.g. "verb-second". */
  slug: string;
  title: string;
  markdown: string;
  order: number;
}

/** One entry in the mistake log: a failed card, or something added by hand. */
export interface Mistake extends SyncMeta {
  at: number;
  cardId: ID | null;
  noteId: ID | null;
  /** What was shown / asked. */
  prompt: string;
  /** What I typed ('' when the card was self-rated). */
  typed: string;
  correct: string;
  tags: string[];
  /** Grammar page slug for the rule, if known. */
  topic: string | null;
  manual: boolean;
}

/** A reading text or dialogue I added myself. `body` uses the same lines as the files in seed/texts. */
export interface TextDoc extends SyncMeta {
  title: string;
  body: string;
}

/** One day's journal entry. */
export interface JournalEntry extends SyncMeta {
  /** Local date, "YYYY-MM-DD". One entry per day. */
  date: string;
  text: string;
  /** The corrections pasted back from Claude, kept for reference. */
  feedback: string;
  /** Today's question that the entry answers (Swedish), if one was shown. */
  prompt?: string;
  promptEn?: string;
  /** The lesson the question came from. */
  lessonNumber?: number | null;
  /** Spoken answers: rows in the media table. Recordings stay on this device. */
  audioIds?: ID[];
}

/**
 * One thing to fix. The mistake log above records every miss as an event; an
 * item is the mistake itself, kept until I have typed it right on three
 * different days.
 */
export interface MistakeItem extends SyncMeta {
  /** Dedupe key: the canonical right answer plus the card (or the prompt when there is no card). */
  key: string;
  /** What was asked, in English where there is one. */
  prompt: string;
  /** My latest wrong answer. */
  typed: string;
  /** The right answer; may hold alternatives separated by " // ". */
  correct: string;
  reason: string;
  tags: string[];
  cardId: ID | null;
  noteId: ID | null;
  /** Where it was caught: 'study', 'verb-drill', 'dictation', 'en-ett', 'builder', 'story', 'checkpoint', 'marked-worksheet', 'seed'. */
  source: string;
  firstWrongAt: number;
  lastWrongAt: number;
  timesWrong: number;
  /** Study-day keys ("YYYY-MM-DD") on which I typed it right, since the last wrong answer. */
  correctDays: string[];
  retiredAt: number | null;
}

export type CheckpointResult = 'pass' | 'close' | 'repeat';

export interface CheckpointItem {
  section: 'recall' | 'production';
  prompt: string;
  typed: string;
  expected: string;
  verdict: 'correct' | 'close' | 'wrong';
  noteId: ID | null;
  reason: string;
}

/** One checkpoint sitting, a paper score entered by hand, or a checkpoint I dismissed. */
export interface Checkpoint extends SyncMeta {
  /** "CP1" … "CP14", "Final", or '' for a score that is not one of the plan's checkpoints. */
  cp: string;
  kind: 'app' | 'paper' | 'old-plan-paper' | 'dismissed';
  label: string;
  week: number | null;
  /** The day it was taken, "YYYY-MM-DD". */
  date: string;
  at: number;
  /** A practice run: saved for the record, never counted as a result. */
  practice: boolean;
  /** Scores from 0 to 1; null when that part was not done. */
  recall: number | null;
  production: number | null;
  writing: number | null;
  writingSelfScored: boolean;
  /** "Did you carry it without switching to English?" */
  speakingWithoutEnglish: boolean | null;
  result: CheckpointResult | null;
  items: CheckpointItem[];
  /** Tag put on the cards I missed ("review-cp1") when the result was Close. */
  reviewTag: string | null;
  writingTask?: string;
  writingText?: string;
  speakingQuestions?: string[];
  speakingNotes?: string;
  audioIds?: ID[];
}

export interface LessonReport {
  title: string;
  paragraphs: string[];
  table: { header: string[]; rows: string[][] } | null;
  patterns: { n: number; title: string; text: string }[];
}

/** What an imported lesson printable leaves behind besides its cards. One row per lesson number. */
export interface Lesson extends SyncMeta {
  number: number;
  /** Plan week, from the Week Map. */
  week: number;
  title: string;
  checklist: string[];
  speakingPrompt: string;
  writingTask: string;
  /** Conversation questions from the lesson's dialogue and reading. */
  questions: { sv: string; en: string }[];
  report: LessonReport | null;
}

export type HoursCategory = 'lessons' | 'speaking' | 'reading-writing' | 'flashcards' | 'listening';
/** In the column order of the Hours Log tab. */
export const HOURS_CATEGORIES: HoursCategory[] = ['lessons', 'speaking', 'reading-writing', 'flashcards', 'listening'];
export const HOURS_LABELS: Record<HoursCategory, string> = {
  lessons: 'Lessons and review',
  speaking: 'Speaking',
  'reading-writing': 'Reading and writing',
  flashcards: 'Flashcards',
  listening: 'Own listening',
};

/** Minutes of study on one day. Flashcard time is not stored here: it is worked out from the reviews. */
export interface HoursEntry extends SyncMeta {
  /** Local date, "YYYY-MM-DD". */
  date: string;
  category: HoursCategory;
  minutes: number;
  /** Logged by the app while a practice tool was in use, as opposed to typed in by me. */
  auto: boolean;
  /** Auto rows only: the exact active time, so many short stretches add up without rounding away. */
  ms?: number;
  note: string;
}

export type ThemeSetting = 'system' | 'light' | 'dark';

export interface Settings {
  /** FSRS desired retention, 0.70 to 0.97. */
  targetRetention: number;
  newPerDay: number;
  reviewsPerDay: number;
  /** Reviews per day that count as "goal met" for the streak. */
  dailyGoal: number;
  theme: ThemeSetting;
  /** Hour (0-23) when a new study day begins, so late-night reviews count for the same day. */
  dayStartHour: number;
  /** Lapses before a card is flagged as a leech. */
  leechThreshold: number;
  newOrder: 'added' | 'random';
  reviewOrder: 'due' | 'random';
  autoPlayAudio: boolean;
  ttsRate: number;
  ttsSlowRate: number;
  /** voiceURI of the chosen Swedish voice; '' picks the best one automatically. */
  ttsVoice: string;
  reminderEnabled: boolean;
  /** "HH:MM", 24h local time. */
  reminderTime: string;
  /** Card types created for new words by default. */
  defaultCardTypes: VocabCardType[];
  /** English → Swedish cards ask me to type the Swedish instead of flipping. */
  typeReverse: boolean;
  /** My current lesson, when I set it myself. null = the newest lesson I have. */
  currentLesson: number | null;
  /** Sentences in a Sentence builder session. */
  builderSize: number;
  /** Count the time the app logged by itself in the weekly hours totals. */
  hoursCountAuto: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  targetRetention: 0.9,
  newPerDay: 10,
  reviewsPerDay: 100,
  dailyGoal: 20,
  theme: 'system',
  dayStartHour: 4,
  leechThreshold: 5,
  newOrder: 'added',
  reviewOrder: 'due',
  autoPlayAudio: false,
  ttsRate: 1,
  ttsSlowRate: 0.6,
  ttsVoice: '',
  reminderEnabled: false,
  reminderTime: '19:00',
  defaultCardTypes: ['basic', 'reverse'],
  typeReverse: true,
  currentLesson: null,
  builderSize: 10,
  hoursCountAuto: true,
};

export interface KeyValue {
  key: string;
  value: unknown;
  updatedAt: number;
}
