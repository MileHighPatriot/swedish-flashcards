// The hours log: what counts as study time, per day and per plan week.

import { PLAN_START, TOTAL_TARGET_HOURS } from '../data/plan';
import { HOURS_CATEGORIES, type HoursCategory, type HoursEntry, type ReviewLog } from '../db/types';
import { addDays, cumulativeTarget, isoDate, targetHours, weekForDate } from './plan';

/** A single review counts for at most this long, so a card left open does not log idle time. */
export const REVIEW_CAP_MS = 60_000;
/** The plan's minimum day: 15 minutes of flashcards. */
export const MIN_FLASHCARD_MINUTES = 15;

/** Time spent on these reviews, each one capped. Cram reviews count: they are time with the cards too. */
export function flashcardMs(reviews: Pick<ReviewLog, 'durationMs' | 'deletedAt'>[]): number {
  return reviews.reduce((sum, r) => (r.deletedAt == null ? sum + Math.min(Math.max(r.durationMs, 0), REVIEW_CAP_MS) : sum), 0);
}

// ---------- weeks ----------


/** The Monday of the calendar week a date falls in. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return addDays(date, -((d.getDay() + 6) % 7));
}

/** Flashcard minutes per calendar day, worked out from the reviews (never stored, so two devices cannot double-count). */
export function flashcardMinutesByDate(reviews: Pick<ReviewLog, 'durationMs' | 'deletedAt' | 'reviewedAt'>[]): Map<string, number> {
  const ms = new Map<string, number>();
  for (const r of reviews) {
    if (r.deletedAt != null) continue;
    const day = isoDate(r.reviewedAt);
    ms.set(day, (ms.get(day) ?? 0) + Math.min(Math.max(r.durationMs, 0), REVIEW_CAP_MS));
  }
  return new Map([...ms].map(([day, v]) => [day, v / 60000]));
}

export type Minutes = Record<HoursCategory, number>;
const zero = (): Minutes => ({ lessons: 0, speaking: 0, 'reading-writing': 0, flashcards: 0, listening: 0 });

export interface HoursInput {
  entries: Pick<HoursEntry, 'date' | 'category' | 'minutes' | 'auto' | 'deletedAt'>[];
  reviews: Pick<ReviewLog, 'durationMs' | 'deletedAt' | 'reviewedAt'>[];
  /** Count the practice time the app logged by itself. Flashcard time from reviews always counts. */
  countAuto: boolean;
}

/** Minutes per category between two dates (inclusive, exclusive). */
export function minutesBetween(input: HoursInput, from: string, to: string): { all: Minutes; auto: Minutes } {
  const all = zero();
  const auto = zero();
  for (const e of input.entries) {
    if (e.deletedAt != null || e.date < from || e.date >= to) continue;
    if (e.auto) {
      auto[e.category] += e.minutes;
      if (input.countAuto) all[e.category] += e.minutes;
    } else all[e.category] += e.minutes;
  }
  for (const [day, minutes] of flashcardMinutesByDate(input.reviews)) {
    if (day < from || day >= to) continue;
    all.flashcards += minutes;
    auto.flashcards += minutes;
  }
  return { all, auto };
}

export const totalOf = (m: Minutes) => HOURS_CATEGORIES.reduce((sum, c) => sum + m[c], 0);

export interface WeekSummary {
  monday: string;
  sunday: string;
  /** Plan week by the calendar; 0 before the plan starts. */
  week: number;
  minutes: Minutes;
  autoMinutes: Minutes;
  totalHours: number;
  targetHours: number;
  /** Logged since the plan started, up to the end of this week. */
  cumulativeHours: number;
  cumulativeTarget: number;
  /** Logged since the plan started, in all. */
  overallHours: number;
  overallTarget: number;
}

export function weekSummary(input: HoursInput, monday: string): WeekSummary {
  const end = addDays(monday, 7);
  const week = weekForDate(monday);
  const { all, auto } = minutesBetween(input, monday, end);
  return {
    monday,
    sunday: addDays(monday, 6),
    week,
    minutes: all,
    autoMinutes: auto,
    totalHours: totalOf(all) / 60,
    targetHours: targetHours(week),
    cumulativeHours: totalOf(minutesBetween(input, PLAN_START, end).all) / 60,
    cumulativeTarget: cumulativeTarget(week),
    overallHours: totalOf(minutesBetween(input, PLAN_START, '9999-12-31').all) / 60,
    overallTarget: TOTAL_TARGET_HOURS,
  };
}

/** Hours to the nearest quarter, as my sheet has them. */
export const quarter = (minutes: number) => Math.round((minutes / 60) * 4) / 4;

/** One tab-separated line in the Hours Log column order: Lessons and review, Speaking, Reading and writing, Flashcards, Own listening. */
export function hoursSheetLine(m: Minutes): string {
  return HOURS_CATEGORIES.map((c) => String(quarter(m[c]))).join('\t');
}

/** "1 h 15 min", "40 min" */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}
