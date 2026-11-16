// Numbers behind the Stats screen and the streak. Pure functions over the
// review history, so they need no stored state and survive backup/restore/sync.

import type { Card, ReviewLog } from '../db/types';
import { maturity, studyDayKey, studyDayStart, type Maturity } from './scheduler';

export interface DayCount {
  /** Every review that day, cram included. */
  all: number;
  /** Scheduled reviews only: what counts toward the daily goal. */
  real: number;
}

/** Reviews per study day, keyed YYYY-MM-DD. */
export function dayCounts(reviews: ReviewLog[], dayStartHour: number): Map<string, DayCount> {
  const out = new Map<string, DayCount>();
  for (const r of reviews) {
    if (r.deletedAt != null) continue;
    const key = studyDayKey(r.reviewedAt, dayStartHour);
    const c = out.get(key) ?? { all: 0, real: 0 };
    c.all++;
    if (!r.cram) c.real++;
    out.set(key, c);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Local noon of a day key: safe to add days to across daylight-saving changes. */
export function dateOfKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export function addDays(key: string, n: number): string {
  const d = dateOfKey(key);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}

export interface Streak {
  /** Days in the current streak (freeze days hold it but do not add to it). */
  current: number;
  best: number;
  /** Freezes in hand. A missed day spends one instead of ending the streak. */
  freezes: number;
  /** Days in the current streak that were saved by a freeze. */
  frozenDays: string[];
  activeToday: boolean;
}

export const START_FREEZES = 1;
export const MAX_FREEZES = 2;
/** Study this many days to earn another freeze. */
export const DAYS_PER_FREEZE = 7;

/**
 * A forgiving streak. Any day with at least one review counts. A missed day
 * uses a freeze if there is one, and the streak carries on; a new freeze is
 * earned for every 7 days studied (you can hold 2). Today never counts
 * against you until it is over.
 */
export function computeStreak(activeDays: Set<string>, today: string): Streak {
  const past = [...activeDays].filter((k) => k <= today).sort();
  const s: Streak = { current: 0, best: 0, freezes: START_FREEZES, frozenDays: [], activeToday: activeDays.has(today) };
  if (past.length === 0) return s;
  let sinceEarned = 0;
  const study = () => {
    s.current++;
    s.best = Math.max(s.best, s.current);
    if (++sinceEarned >= DAYS_PER_FREEZE) {
      sinceEarned = 0;
      s.freezes = Math.min(MAX_FREEZES, s.freezes + 1);
    }
  };
  for (let day = past[0]; day < today; day = addDays(day, 1)) {
    if (activeDays.has(day)) study();
    else if (s.current > 0 && s.freezes > 0) {
      s.freezes--;
      s.frozenDays.push(day);
    } else {
      s.current = 0;
      s.frozenDays = [];
      sinceEarned = 0;
    }
  }
  if (s.activeToday) study();
  return s;
}

export interface Retention {
  total: number;
  passed: number;
  /** Share of graduated reviews answered Hard, Good or Easy; null with no data. */
  rate: number | null;
}

/** True retention: how often a card that was due for review was remembered. */
export function retention(reviews: ReviewLog[], since = 0): Retention {
  const due = reviews.filter((r) => r.deletedAt == null && !r.cram && r.state === 2 && r.reviewedAt >= since);
  const passed = due.filter((r) => r.rating > 1).length;
  return { total: due.length, passed, rate: due.length ? passed / due.length : null };
}

export type MaturityCounts = Record<Maturity, number> & { suspended: number };

export function maturityCounts(cards: Card[]): MaturityCounts {
  const out: MaturityCounts = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
  for (const c of cards) {
    if (c.deletedAt != null) continue;
    if (c.suspended) out.suspended++;
    else out[maturity(c)]++;
  }
  return out;
}

export interface ForecastDay {
  key: string;
  /** Cards that fall due that day. Overdue cards are counted on the first day. */
  count: number;
}

/** Reviews coming up over the next `days` days, today first. New cards are not included. */
export function forecast(cards: Card[], now: number, dayStartHour: number, days = 14): ForecastDay[] {
  const today = studyDayKey(now, dayStartHour);
  const out: ForecastDay[] = Array.from({ length: days }, (_, i) => ({ key: addDays(today, i), count: 0 }));
  const index = new Map(out.map((d, i) => [d.key, i]));
  const start = studyDayStart(now, dayStartHour);
  for (const c of cards) {
    if (c.deletedAt != null || c.suspended || c.state === 0) continue;
    const i = c.due < start ? 0 : index.get(studyDayKey(c.due, dayStartHour));
    if (i !== undefined) out[i].count++;
  }
  return out;
}

export interface HeatCell {
  key: string;
  count: number;
  /** 0 = nothing, 1-4 = light to dark. */
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

/**
 * Calendar grid for the review heatmap: one column per week (Monday first),
 * ending with the current week. Shading is relative to the daily goal, so a
 * day at or above the goal is the darkest step.
 */
export function heatmap(counts: Map<string, DayCount>, today: string, weeks: number, goal: number): HeatCell[][] {
  const t = dateOfKey(today);
  const mondayOffset = (t.getDay() + 6) % 7; // days since Monday
  const first = addDays(today, -mondayOffset - 7 * (weeks - 1));
  const full = Math.max(1, goal);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d): HeatCell => {
      const key = addDays(first, w * 7 + d);
      const count = counts.get(key)?.all ?? 0;
      const level = count === 0 ? 0 : (Math.min(4, Math.max(1, Math.ceil((count / full) * 4))) as 1 | 2 | 3 | 4);
      return { key, count, level, future: key > today };
    }),
  );
}
