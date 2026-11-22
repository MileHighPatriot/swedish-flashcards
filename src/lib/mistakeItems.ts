// "My mistakes": one item per thing I got wrong, kept until I have typed it
// right on three different study days with no wrong answer in between. Pure
// functions here; the database side is in db/repo.ts.

import type { ID, MistakeItem } from '../db/types';
import { canon } from './check';
import { splitAlternatives } from './parser';
import { studyDayKey } from './scheduler';

/** Days of right answers that retire an item. */
export const RETIRE_DAYS = 3;
/** Items shown at the start of a study session. */
export const SESSION_ITEMS = 10;

export interface WrongInput {
  prompt: string;
  typed: string;
  correct: string;
  reason: string;
  tags: string[];
  cardId: ID | null;
  noteId: ID | null;
  source: string;
}

/** The same mistake is one item: same right answer, on the same card (or under the same prompt). */
export function mistakeKey(correct: string, cardId: ID | null, prompt: string): string {
  const answer = canon(splitAlternatives(correct)[0] ?? correct).toLowerCase();
  return `${answer}|${cardId ?? canon(prompt).toLowerCase()}`;
}

/** A wrong answer: a new item, or the old one back at zero days (and out of retirement). */
export function applyWrong(existing: MistakeItem | undefined, input: WrongInput, now: number, newId: () => ID): MistakeItem {
  if (existing)
    return {
      ...existing,
      typed: input.typed.trim() || existing.typed,
      reason: input.reason || existing.reason,
      tags: [...new Set([...existing.tags, ...input.tags])],
      lastWrongAt: now,
      timesWrong: existing.timesWrong + 1,
      correctDays: [],
      retiredAt: null,
      deletedAt: null,
      updatedAt: now,
    };
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    key: mistakeKey(input.correct, input.cardId, input.prompt),
    prompt: input.prompt.trim(),
    typed: input.typed.trim(),
    correct: input.correct.trim(),
    reason: input.reason,
    tags: input.tags,
    cardId: input.cardId,
    noteId: input.noteId,
    source: input.source,
    firstWrongAt: now,
    lastWrongAt: now,
    timesWrong: 1,
    correctDays: [],
    retiredAt: null,
  };
}

/** A right answer: counts once per study day; the third day retires the item. */
export function applyCorrect(item: MistakeItem, now: number, dayStartHour: number): MistakeItem {
  if (item.retiredAt != null) return item;
  const day = studyDayKey(now, dayStartHour);
  if (item.correctDays.includes(day)) return item;
  const correctDays = [...item.correctDays, day];
  return { ...item, correctDays, retiredAt: correctDays.length >= RETIRE_DAYS ? now : null, updatedAt: now };
}

export const isActive = (i: MistakeItem) => i.deletedAt == null && i.retiredAt == null;

/** Active items I have not typed right today: most-missed first, then the one waiting longest. */
export function dueItems(items: MistakeItem[], now: number, dayStartHour: number, limit = SESSION_ITEMS): MistakeItem[] {
  const today = studyDayKey(now, dayStartHour);
  return items
    .filter((i) => isActive(i) && !i.correctDays.includes(today))
    .sort((a, b) => b.timesWrong - a.timesWrong || a.lastWrongAt - b.lastWrongAt || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** "1 of 3 days" */
export const dayCount = (i: MistakeItem) => `${Math.min(i.correctDays.length, RETIRE_DAYS)} of ${RETIRE_DAYS} days`;

// ---------- the seed file ----------

export interface SeedMistake extends WrongInput {
  timesWrong: number;
}

/** seed/my-mistakes.txt: English prompt | what I wrote | correct | reason | tags | times wrong */
export function parseMistakeSeed(text: string): SeedMistake[] {
  const out: SeedMistake[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [prompt = '', typed = '', correct = '', reason = '', tags = '', times = '1'] = line.split('|').map((f) => f.trim());
    if (!prompt || !correct) continue;
    out.push({
      prompt,
      typed,
      correct,
      reason,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      cardId: null,
      noteId: null,
      source: 'seed',
      timesWrong: Math.max(1, Number(times) || 1),
    });
  }
  return out;
}
