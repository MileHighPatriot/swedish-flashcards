// Conversation questions: the ones in seed/conversation-prompts.txt plus the
// ones saved with each imported lesson. Used for "Today's question" in the
// journal and for the speaking part of a checkpoint.

import promptsText from '../../seed/conversation-prompts.txt?raw';
import type { JournalEntry, Lesson } from '../db/types';
import { canon } from './check';
import { addDays } from './plan';

export interface Prompt {
  lesson: number | null;
  sv: string;
  en: string;
}

/** lesson | Swedish | English */
export function parsePrompts(text: string): Prompt[] {
  const out: Prompt[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [lesson = '', sv = '', en = ''] = line.split('|').map((f) => f.trim());
    if (sv) out.push({ lesson: /^\d+$/.test(lesson) ? Number(lesson) : null, sv, en });
  }
  return out;
}

export const SEED_PROMPTS: Prompt[] = parsePrompts(promptsText);

// The journal's first three starters, in the two-word spelling. They are the first three seed lines as well.
export const STARTERS = ['Vad gjorde du i går?', 'Hur var din dag?', 'Vad gjorde du i helgen?'];

const keyOf = (sv: string) => canon(sv).toLowerCase();

/** Every question I have, once each: the starters, the seed file, then my imported lessons. */
export function allPrompts(lessons: Pick<Lesson, 'number' | 'questions' | 'deletedAt'>[], seed: Prompt[] = SEED_PROMPTS): Prompt[] {
  const seen = new Map<string, Prompt>();
  const add = (p: Prompt) => {
    const k = keyOf(p.sv);
    if (k && !seen.has(k)) seen.set(k, p);
  };
  seed.forEach(add);
  for (const sv of STARTERS) add({ lesson: null, sv, en: '' });
  for (const l of [...lessons].sort((a, b) => a.number - b.number)) if (l.deletedAt == null) for (const q of l.questions) add({ lesson: l.number, sv: q.sv, en: q.en });
  return [...seen.values()];
}

/** A small stable hash of a date, so the same day always gives the same question. */
function dayNumber(date: string): number {
  let h = 2166136261;
  for (const ch of date) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Today's question. The same date always gives the same one. Questions from
 * my current lesson come first; one I was asked in the last 7 days is passed
 * over (unless there is nothing else).
 */
export function pickPrompt(date: string, prompts: Prompt[], currentLesson: number, journal: Pick<JournalEntry, 'date' | 'prompt' | 'deletedAt'>[]): Prompt | null {
  if (prompts.length === 0) return null;
  const from = addDays(date, -7);
  const recent = new Set(journal.filter((e) => e.deletedAt == null && e.prompt && e.date >= from && e.date < date).map((e) => keyOf(e.prompt!)));
  const fresh = prompts.filter((p) => !recent.has(keyOf(p.sv)));
  const pool = fresh.length ? fresh : prompts;
  const mine = pool.filter((p) => p.lesson === currentLesson);
  const from2 = mine.length ? mine : pool;
  return from2[dayNumber(date) % from2.length];
}

/** What "Copy for my tutor" puts on the clipboard for a journal entry. */
export function journalForTutor(e: { date: string; lessonNumber: number | null; prompt: string; promptEn: string; text: string; hasRecording: boolean }): string {
  return [
    `Journal ${e.date}${e.lessonNumber != null ? ` (Lesson ${e.lessonNumber})` : ''}`,
    e.prompt ? `Question: ${e.prompt}${e.promptEn ? ` (${e.promptEn})` : ''}` : '',
    '',
    'My answer:',
    e.text.trim() || '(no written answer)',
    e.hasRecording ? '\n(recording saved on my phone)' : '',
  ]
    .filter((l, i) => l !== '' || i === 2)
    .join('\n')
    .trimEnd();
}
