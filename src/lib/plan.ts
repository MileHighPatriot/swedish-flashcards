// Where I am in the B2 plan. The data lives in src/data/plan.ts; this is the
// arithmetic on top of it. Content follows my lessons (the current week is the
// week of the newest lesson I have), the hours log follows the calendar.

import { CHECKPOINTS, PHASES, SHORT_WEEKS, WEEK_HOURS, WEEK_MAP, WEEK_ZERO_LESSONS, type PlanCheckpoint, type PlanPhase } from '../data/plan';
import type { Checkpoint, Deck, Settings } from '../db/types';

export const LAST_WEEK = WEEK_MAP[WEEK_MAP.length - 1].week;

/** Local calendar date as "YYYY-MM-DD". */
export function isoDate(d: Date | number): string {
  const x = typeof d === 'number' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" plus a number of days, DST-safe. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + days, 12));
}

/** The plan week a lesson belongs to. Lessons 1 to 5 (and anything earlier) are week 0. */
export function weekForLesson(n: number): number {
  if (n <= WEEK_ZERO_LESSONS[1]) return 0;
  const row = WEEK_MAP.find((w) => w.lessons && n >= w.lessons[0] && n <= w.lessons[1]);
  // A lesson past the end of the map belongs to the last teaching week.
  return row ? row.week : LAST_WEEK - 1;
}

/** Lesson numbers of a plan week. Week 0 is lessons 1 to 5; week 58 has none. */
export function lessonsOfWeek(week: number): number[] {
  const range = week <= 0 ? WEEK_ZERO_LESSONS : (WEEK_MAP.find((w) => w.week === week)?.lessons ?? null);
  if (!range) return [];
  return Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i);
}

/** The plan week a calendar date falls in: the row whose Monday is on or before it. Before the plan starts: 0. */
export function weekForDate(date: Date | number | string): number {
  const key = typeof date === 'string' ? date : isoDate(date);
  let week = 0;
  for (const w of WEEK_MAP) if (w.start <= key) week = w.week;
  return week;
}

/** Monday of a plan week, "YYYY-MM-DD". Week 0 has no fixed start. */
export const weekStart = (week: number): string | null => WEEK_MAP.find((w) => w.week === week)?.start ?? null;

export function phaseForWeek(week: number): PlanPhase | null {
  return PHASES.find((p) => week >= p.weeks[0] && week <= p.weeks[1]) ?? null;
}

/** Hours I planned for a week: 11, or 9 in the two holiday weeks. Nothing before the plan or after it. */
export function targetHours(week: number): number {
  if (week < 1 || week > LAST_WEEK) return 0;
  return SHORT_WEEKS[week] ?? WEEK_HOURS;
}

/** Planned hours from week 1 up to and including `week`. */
export function cumulativeTarget(week: number): number {
  let sum = 0;
  for (let w = 1; w <= Math.min(week, LAST_WEEK); w++) sum += targetHours(w);
  return sum;
}

export const checkpointList = (): PlanCheckpoint[] => CHECKPOINTS;
export const checkpointOf = (cp: string): PlanCheckpoint | undefined => CHECKPOINTS.find((c) => c.cp.toLowerCase() === cp.toLowerCase());

/**
 * The weeks a checkpoint tests: everything after the previous checkpoint up to
 * its own week. The first one also takes in week 0, the Final takes in everything.
 */
export function blockWeeks(cp: string): number[] {
  const i = CHECKPOINTS.findIndex((c) => c.cp === cp);
  if (i < 0) return [];
  const from = cp === 'Final' || i === 0 ? 0 : CHECKPOINTS[i - 1].week + 1;
  return Array.from({ length: CHECKPOINTS[i].week - from + 1 }, (_, k) => from + k);
}

/** The newest lesson I have: the highest lesson number among my unlocked decks, unless I set it myself. */
export function currentLesson(decks: Pick<Deck, 'lessonNumber' | 'locked' | 'deletedAt'>[], settings: Pick<Settings, 'currentLesson'>): number {
  if (settings.currentLesson != null) return settings.currentLesson;
  return Math.max(0, ...decks.filter((d) => d.deletedAt == null && !d.locked && d.lessonNumber != null).map((d) => d.lessonNumber!));
}

export interface PlanPosition {
  lesson: number;
  /** The week of my newest lesson: what "this week" means for content. */
  week: number;
  phase: PlanPhase | null;
  /** The plan week by the calendar. Shown only when it differs from `week`. */
  weekByDate: number;
}

export function planPosition(decks: Pick<Deck, 'lessonNumber' | 'locked' | 'deletedAt'>[], settings: Pick<Settings, 'currentLesson'>, now: number): PlanPosition {
  const lesson = currentLesson(decks, settings);
  const week = weekForLesson(lesson);
  return { lesson, week, phase: phaseForWeek(week), weekByDate: weekForDate(now) };
}

export const lessonTagOf = (n: number) => `lesson-${String(n).padStart(2, '0')}`;
export const weekTagOf = (w: number) => `week-${String(w).padStart(2, '0')}`;

/** The lesson a card belongs to, from its lesson-NN tag or its lesson number. */
export function lessonNumberOf(n: { tags: string[]; lessonNumber: number | null }): number | null {
  const tag = n.tags.find((t) => /^lesson-\d+$/i.test(t));
  return tag ? Number(tag.slice(7)) : n.lessonNumber;
}

type Sitting = Pick<Checkpoint, 'cp' | 'kind' | 'practice' | 'result' | 'reviewTag' | 'at' | 'deletedAt'>;

/** Real sittings only: taken in the app or entered from paper, not a practice run, an old-plan score or a dismissal. */
export const isRealSitting = (c: Pick<Checkpoint, 'kind' | 'practice' | 'deletedAt'>) => c.deletedAt == null && !c.practice && (c.kind === 'app' || c.kind === 'paper');

/** The latest real sitting of a checkpoint. */
export function latestSitting<T extends Sitting>(rows: T[], cp: string): T | undefined {
  return rows.filter((c) => c.cp === cp && isRealSitting(c)).sort((a, b) => b.at - a.at)[0];
}

/**
 * The tags behind "This week's lesson": every lesson of the week, plus the
 * review set of last week's checkpoint when that came out "Close".
 */
export function weekSessionTags(week: number, checkpoints: Sitting[]): string[] {
  const tags = lessonsOfWeek(week).map(lessonTagOf);
  const before = CHECKPOINTS.find((c) => c.week === week - 1);
  const sat = before && latestSitting(checkpoints, before.cp);
  if (sat?.result === 'close' && sat.reviewTag) tags.push(sat.reviewTag);
  return tags;
}
