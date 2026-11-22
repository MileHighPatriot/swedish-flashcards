// Checkpoints of the B2 plan: when each one shows up, what it tests, how it is
// scored, and what goes on the clipboard for my sheet and my tutor. The dates
// come from src/data/plan.ts. The app never writes to the Google Sheet.

import { CHECKPOINTS, WEEK_TOPICS, type PlanCheckpoint } from '../data/plan';
import type { Checkpoint, CheckpointItem, CheckpointResult, ID, Lesson, MistakeItem, Note } from '../db/types';
import { builderPool } from './builder';
import { checkAnswer, checkVocab, type Verdict } from './check';
import { makeCloze } from './cloze';
import { dueItems } from './mistakeItems';
import { splitAlternatives } from './parser';
import { addDays, blockWeeks, isRealSitting, isoDate, lessonNumberOf, lessonsOfWeek, weekStart } from './plan';
import { allPrompts, type Prompt } from './prompts';
import type { ReadingText } from './texts';
import { verbTable } from './verbtable';

export const SECTION_MINUTES = { recall: 15, production: 20, writing: 20, speaking: 20 } as const;
export type Section = keyof typeof SECTION_MINUTES;
export const SECTIONS: Section[] = ['recall', 'production', 'writing', 'speaking'];
export const SECTION_LABELS: Record<Section, string> = { recall: 'Recall', production: 'Production', writing: 'Writing', speaking: 'Speaking' };

export const PASS_MARK = 0.8;
export const CLOSE_MARK = 0.7;
export const HARDER_MARK = 0.9;

// ---------- when ----------

export type CheckpointState =
  | 'upcoming' // its week has not started
  | 'this-week' // shown on Home from the Monday of its week
  | 'due' // today is the day
  | 'not-taken' // the day has passed with no real sitting
  | 'taken'
  | 'dismissed';

type Row = Pick<Checkpoint, 'cp' | 'kind' | 'practice' | 'at' | 'deletedAt'>;

export function checkpointState(cp: PlanCheckpoint, now: number | string, rows: Row[]): CheckpointState {
  const today = typeof now === 'string' ? now : isoDate(now);
  const mine = rows.filter((r) => r.cp === cp.cp && r.deletedAt == null);
  if (mine.some(isRealSitting)) return 'taken';
  if (mine.some((r) => r.kind === 'dismissed')) return 'dismissed';
  if (today > cp.date) return 'not-taken';
  if (today === cp.date) return 'due';
  return today >= (weekStart(cp.week) ?? cp.date) ? 'this-week' : 'upcoming';
}

/** The checkpoint Home should mention: the earliest one that is this week, due, or overdue. */
export function openCheckpoint(now: number | string, rows: Row[]): { cp: PlanCheckpoint; state: CheckpointState } | null {
  for (const cp of CHECKPOINTS) {
    const state = checkpointState(cp, now, rows);
    if (state === 'this-week' || state === 'due' || state === 'not-taken') return { cp, state };
  }
  return null;
}

export const STATE_LABELS: Record<CheckpointState, string> = {
  upcoming: 'Coming up',
  'this-week': 'This week',
  due: 'Due today',
  'not-taken': 'Not taken',
  taken: 'Taken',
  dismissed: 'Dismissed',
};

/** Lessons a checkpoint tests: every lesson of its block of weeks. */
export function blockLessons(cp: string): number[] {
  return blockWeeks(cp).flatMap(lessonsOfWeek);
}

// ---------- scoring ----------

/**
 * Pass: production 80% or more, and the speaking part carried without English.
 * Close: production 70% to 80%, or 80%+ with English in the speaking part.
 * Under 70%: repeat the block.
 */
export function resultOf(production: number | null, speakingWithoutEnglish: boolean | null): CheckpointResult | null {
  if (production == null) return null;
  // Scores are fractions of small whole numbers; a hair of rounding must not turn 80% into 79.99%.
  const p = Math.round(production * 1000) / 1000;
  if (p < CLOSE_MARK) return 'repeat';
  return p >= PASS_MARK && speakingWithoutEnglish === true ? 'pass' : 'close';
}

export const RESULT_LABELS: Record<CheckpointResult, string> = {
  pass: 'Pass',
  close: 'Close: rebuild next week',
  repeat: 'Repeat this block',
};

/** Share of typed answers that count: right, plus close ("watch") when `closeCounts`. */
export function scoreOf(verdicts: Verdict[], closeCounts: boolean): number | null {
  if (verdicts.length === 0) return null;
  return verdicts.filter((v) => v === 'correct' || (closeCounts && v === 'close')).length / verdicts.length;
}

/**
 * "Ready for harder lessons": the last two sittings, in the order I took them,
 * are both real and both over 90% on production. Old-plan paper scores and
 * dismissals do not take part; a practice run in between breaks the pair.
 */
export function readyForHarder(rows: Pick<Checkpoint, 'kind' | 'practice' | 'production' | 'at' | 'deletedAt'>[]): boolean {
  const sat = rows.filter((r) => r.deletedAt == null && (r.kind === 'app' || r.kind === 'paper')).sort((a, b) => a.at - b.at);
  const last = sat.slice(-2);
  return last.length === 2 && last.every((r) => !r.practice && r.production != null && r.production > HARDER_MARK);
}

export const reviewTagFor = (cp: string) => `review-${cp.toLowerCase()}`;

const pct = (n: number | null) => (n == null ? '' : `${Math.round(n * 100)}%`);

/** One tab-separated line in the column order of my Checkpoints tab: Recall, Production, Writing, Speaking yes/no, Result. */
export function sheetLine(r: Pick<Checkpoint, 'recall' | 'production' | 'writing' | 'speakingWithoutEnglish' | 'result'>): string {
  return [pct(r.recall), pct(r.production), pct(r.writing), r.speakingWithoutEnglish == null ? '' : r.speakingWithoutEnglish ? 'yes' : 'no', r.result ? RESULT_LABELS[r.result] : ''].join('\t');
}

// ---------- the timer ----------

export interface Countdown {
  remainingMs: number;
  running: boolean;
  ended: boolean;
}

export const startCountdown = (minutes: number): Countdown => ({ remainingMs: minutes * 60_000, running: true, ended: false });

/** Time passes only while the clock is running. Reaching zero ends the section. */
export function tick(c: Countdown, elapsedMs: number): Countdown {
  if (!c.running || c.ended) return c;
  const remainingMs = Math.max(0, c.remainingMs - elapsedMs);
  return { remainingMs, running: remainingMs > 0, ended: remainingMs === 0 };
}

export const pause = (c: Countdown): Countdown => (c.ended ? c : { ...c, running: false });
export const resume = (c: Countdown): Countdown => (c.ended ? c : { ...c, running: true });

/** "14:05" */
export function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- what is asked ----------

export interface TestItem {
  section: 'recall' | 'production';
  /** A short line above the prompt: "Say it in Swedish", "Past tense of". */
  label: string;
  prompt: string;
  /** Accepted answers. */
  answers: string[];
  noteId: ID | null;
  cardId: ID | null;
  tags: string[];
  /** A single word of mine: "en hund" is as good as "hund". */
  word: Pick<Note, 'swedish' | 'noun' | 'verb'> | null;
  /** Already on My mistakes: answering it here counts there. */
  mistake: MistakeItem | null;
}

export interface BuildInput {
  cp: string;
  notes: Note[];
  texts: ReadingText[];
  items: MistakeItem[];
  lessons: Lesson[];
  now: number;
  dayStartHour: number;
  rng?: () => number;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const RECALL_WORDS = 12;
export const RECALL_VERBS = 6;
export const RECALL_MISTAKES = 3;
export const PRODUCTION_SENTENCES = 8;
export const PRODUCTION_BLANKS = 6;

const inBlock = (lessons: Set<number>) => (n: { tags: string[]; lessonNumber: number | null }) => {
  const l = lessonNumberOf(n);
  return l != null && lessons.has(l);
};

/** Recall: the block's words and verb forms from English cues, and up to 3 of my open mistakes. */
export function recallItems(input: BuildInput): TestItem[] {
  const rng = input.rng ?? Math.random;
  const lessons = new Set(blockLessons(input.cp));
  const notes = input.notes.filter((n) => n.deletedAt == null && n.kind === 'vocab' && inBlock(lessons)(n));
  const words = shuffle(notes.filter((n) => !n.verb && n.english.trim() && !/\s/.test(n.swedish.trim())), rng)
    .slice(0, RECALL_WORDS)
    .map((n): TestItem => ({ section: 'recall', label: 'Say it in Swedish', prompt: n.english, answers: [n.swedish], noteId: n.id, cardId: null, tags: n.tags, word: n, mistake: null }));
  const verbs = shuffle(verbTable(notes).filter((v) => v.past), rng)
    .slice(0, RECALL_VERBS)
    .map((v): TestItem => ({ section: 'recall', label: 'Past tense of', prompt: `${v.infinitive} (${v.english})`, answers: [v.past], noteId: v.noteId, cardId: null, tags: v.tags, word: null, mistake: null }));
  const mistakes = dueItems(input.items, input.now, input.dayStartHour, RECALL_MISTAKES).map(
    (m): TestItem => ({ section: 'recall', label: 'From My mistakes', prompt: m.prompt, answers: splitAlternatives(m.correct), noteId: m.noteId, cardId: m.cardId, tags: m.tags, word: null, mistake: m }),
  );
  return [...shuffle([...words, ...verbs], rng), ...mistakes];
}

/** Production: English to Swedish sentences from the block, and blanks to fill in its example sentences. */
export function productionItems(input: BuildInput): TestItem[] {
  const rng = input.rng ?? Math.random;
  const lessons = new Set(blockLessons(input.cp));
  const sentences = shuffle(builderPool({ notes: input.notes, texts: input.texts }).filter((i) => i.lesson != null && lessons.has(i.lesson)), rng)
    .slice(0, PRODUCTION_SENTENCES)
    .map((i): TestItem => ({ section: 'production', label: 'Say it in Swedish', prompt: i.en, answers: splitAlternatives(i.sv), noteId: i.hasNote ? i.noteId : null, cardId: null, tags: i.tags, word: null, mistake: null }));
  const used = new Set(sentences.flatMap((s) => s.answers));
  const blanks = shuffle(input.notes.filter((n) => n.deletedAt == null && n.kind === 'vocab' && inBlock(lessons)(n) && n.exampleSv && n.exampleEn && !used.has(n.exampleSv)), rng)
    .flatMap((n): TestItem[] => {
      const c = makeCloze(n);
      return c ? [{ section: 'production', label: 'Fill in the blank', prompt: `${c.before}____${c.after}  (${n.exampleEn})`, answers: [c.answer], noteId: n.id, cardId: null, tags: n.tags, word: null, mistake: null }] : [];
    })
    .slice(0, PRODUCTION_BLANKS);
  return [...sentences, ...blanks];
}

export function gradeItem(item: TestItem, typed: string) {
  return item.word ? checkVocab(typed, item.word) : checkAnswer(typed, item.answers);
}

export interface WritingTask {
  /** The newest imported lesson of the block that has a writing section, or null for the default task. */
  lesson: number | null;
  task: string;
  /** What to check my own text against. */
  selfCheck: string[];
}

export const DEFAULT_WRITING = 'Write 8 to 10 sentences about your week.';

export function writingTask(cp: string, lessons: Pick<Lesson, 'number' | 'writingTask' | 'deletedAt'>[]): WritingTask {
  const block = new Set(blockLessons(cp));
  const topics = [...new Set(blockWeeks(cp).flatMap((w) => WEEK_TOPICS[w] ?? []))];
  const newest = lessons.filter((l) => l.deletedAt == null && block.has(l.number) && l.writingTask.trim()).sort((a, b) => b.number - a.number)[0];
  return {
    lesson: newest?.number ?? null,
    task: newest ? newest.writingTask.trim() : topics.length ? `${DEFAULT_WRITING} Use what this block covered: ${topics.join('; ')}.` : DEFAULT_WRITING,
    selfCheck: [...topics.map((t) => `I used: ${t}`), 'The verb is in seat 2 in every main clause', 'I wrote å, ä and ö, and no capitals in the middle of a sentence'],
  };
}

export const SPEAKING_QUESTIONS = 5;

/** 4 to 5 conversation questions from the block's lessons (fewer only when I have fewer). */
export function speakingQuestions(cp: string, lessons: Pick<Lesson, 'number' | 'questions' | 'deletedAt'>[], rng: () => number = Math.random, seed?: Prompt[]): Prompt[] {
  const block = new Set(blockLessons(cp));
  const all = allPrompts(lessons, seed);
  const mine = all.filter((p) => p.lesson != null && block.has(p.lesson));
  return shuffle(mine.length ? mine : all, rng).slice(0, SPEAKING_QUESTIONS);
}

// ---------- hand-offs ----------

export function writingForTutor(x: { cp: string; date: string; task: string; text: string }): string {
  return [`${x.cp === 'Final' ? 'Final exam' : `Checkpoint ${x.cp.replace(/^CP/, '')}`}, writing, ${x.date}`, `Task: ${x.task}`, '', 'My text:', x.text.trim() || '(nothing written)'].join('\n');
}

export function speakingForTutor(x: { cp: string; date: string; questions: string[]; notes: string; recordings: number }): string {
  return [
    `${x.cp === 'Final' ? 'Final exam' : `Checkpoint ${x.cp.replace(/^CP/, '')}`}, speaking, ${x.date}`,
    'Questions:',
    ...x.questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'My notes:',
    x.notes.trim() || '(no notes)',
    ...(x.recordings > 0 ? ['', '(recordings saved on my phone)'] : []),
  ].join('\n');
}

/** My three paper scores from the old plan. Kept in the history, never part of a result. */
export const OLD_PLAN_SCORES: { id: string; label: string; score: number }[] = [
  { id: 'seed:checkpoint:old-lesson-2', label: 'Lesson 2 worksheet', score: 0.71 },
  { id: 'seed:checkpoint:old-lesson-3', label: 'Lesson 3 worksheet', score: 0.7 },
  { id: 'seed:checkpoint:old-lesson-4', label: 'Lesson 4 worksheet (old Week 1 checkpoint)', score: 0.79 },
];

export const checkpointTitle = (cp: string) => (cp === 'Final' ? 'Final B2 exam' : `Checkpoint ${cp.replace(/^CP/, '')}`);

/** Misses of a sitting: what goes on My mistakes and, after a Close, under the review tag. */
export const missesOf = (items: CheckpointItem[]) => items.filter((i) => i.verdict === 'wrong');

/** The days a checkpoint is on Home before its date: from the Monday of its week. */
export const showsFrom = (cp: PlanCheckpoint): string => weekStart(cp.week) ?? addDays(cp.date, -6);
