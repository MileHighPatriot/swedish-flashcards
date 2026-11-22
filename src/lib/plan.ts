// Where I am in the B2 plan. The data lives in src/data/plan.ts; this is the
// arithmetic on top of it. Content follows my lessons (the current week is the
// week of the newest lesson I have), the hours log follows the calendar.

import {
  CHECKPOINTS,
  CHECKPOINT_SUNDAY,
  HOLIDAY_WEEKS,
  PHASES,
  PLAN_END,
  PLAN_START,
  SHORT_FRIDAY,
  SHORT_WEEKS,
  WEEKLY_SCHEDULE,
  WEEK_HOURS,
  WEEK_MAP,
  WEEK_ZERO_LESSONS,
  type DayType,
  type PlanCheckpoint,
  type PlanPhase,
  type ScheduleDay,
} from '../data/plan';
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

// ---------- today, from the Weekly Schedule ----------


/** 1 = Monday … 7 = Sunday, for a local "YYYY-MM-DD". */
export function weekdayOf(date: string): number {
  return ((new Date(`${date}T12:00:00`).getDay() + 6) % 7) + 1;
}

/** A short week has Lessons A and B only: every checkpoint week, and the two holiday weeks. */
export function isShortWeek(week: number): boolean {
  const row = WEEK_MAP.find((w) => w.week === week);
  return !!row && row.lessons != null && (row.checkpoint != null || HOLIDAY_WEEKS.includes(week));
}

/** The seven days of a plan week as the schedule lays them out. */
export function scheduleOfWeek(week: number): ScheduleDay[] {
  const row = WEEK_MAP.find((w) => w.week === week);
  if (!row) return [];
  return WEEKLY_SCHEDULE.map((d) => {
    // Week 58 has no lessons: its weekdays are review days up to the Final on the Saturday.
    if (!row.lessons) return d.type === 'lesson' ? { ...SHORT_FRIDAY, day: d.day, name: d.name } : d;
    if (d.day === 5 && isShortWeek(week)) return SHORT_FRIDAY;
    if (d.day === 7 && row.checkpoint) return CHECKPOINT_SUNDAY;
    return d;
  });
}

/** The lesson the Week Map puts on a lesson day (A, B, C = first, second, third lesson of the week). */
function lessonOfSlot(week: number, slot: 'A' | 'B' | 'C'): number | null {
  return lessonsOfWeek(week)['ABC'.indexOf(slot)] ?? null;
}

/** The newest lesson the plan has reached by this date: 5 before the plan starts. */
export function expectedLesson(date: string): number {
  const week = weekForDate(date);
  if (week === 0) return WEEK_ZERO_LESSONS[1];
  const today = weekdayOf(date);
  let lesson = lessonsOfWeek(week - 1).slice(-1)[0] ?? (week > 1 ? lessonsOfWeek(week - 2).slice(-1)[0] : undefined) ?? WEEK_ZERO_LESSONS[1];
  for (const d of scheduleOfWeek(week)) if (d.day <= today && d.slot) lesson = lessonOfSlot(week, d.slot) ?? lesson;
  return lesson;
}

export interface Today {
  date: string;
  /** Plan week by the calendar. 0 before the plan starts; never shown as "Week 0". */
  week: number;
  /** null outside the plan (before it starts, after the Final). */
  dayType: DayType | null;
  schedule: ScheduleDay | null;
  /** The lesson for today: the newest lesson I have. null when there is none to name. */
  lesson: number | null;
  /** The lesson the Week Map expects me to have reached today. */
  expected: number;
  /** How many lessons my progress is short of that. */
  behind: number;
  /** "Lesson 6, day 1", "Review of Lesson 6", "Checkpoint test", "Plan starts tomorrow"… */
  status: string;
  /** "You're one lesson behind the plan", or null. */
  note: string | null;
  /** The checkpoint taken today, if any. */
  checkpoint: PlanCheckpoint | null;
}

/**
 * What today is. The calendar date (the device's local time) sets the week and
 * the kind of day; my progress (the highest lesson I have unlocked) sets the
 * lesson. Nothing is ticked by hand and nothing is stored.
 */
export function resolveToday(date: Date | number | string, progress: { lesson: number }): Today {
  const day = typeof date === 'string' ? date : isoDate(date);
  const base = { date: day, week: 0, dayType: null, schedule: null, lesson: null, expected: WEEK_ZERO_LESSONS[1], behind: 0, note: null, checkpoint: null };
  if (day < PLAN_START) return { ...base, status: day === addDays(PLAN_START, -1) ? 'Plan starts tomorrow' : 'Plan starts Mon Nov 23' };
  if (day > PLAN_END) return { ...base, week: LAST_WEEK, expected: expectedLesson(PLAN_END), status: 'The plan is finished' };

  const week = weekForDate(day);
  const checkpoint = CHECKPOINTS.find((c) => c.date === day) ?? null;
  const planned = scheduleOfWeek(week).find((d) => d.day === weekdayOf(day))!;
  // The Final sits on a Saturday, in a week with no lessons.
  const schedule: ScheduleDay = checkpoint?.cp === 'Final' ? { ...planned, type: 'final', minutes: 75, tasks: ['Final B2 exam'] } : planned;
  const expected = expectedLesson(day);
  const lesson = progress.lesson > 0 ? progress.lesson : null;
  const behind = Math.max(0, expected - progress.lesson);
  const hasLessons = lessonsOfWeek(week).length > 0;

  let status: string;
  switch (schedule.type) {
    case 'lesson':
      status = lesson != null ? `Lesson ${lesson}, day ${schedule.day}` : `Lesson day ${schedule.day}`;
      break;
    case 'review':
      status = hasLessons && lesson != null ? `Review of Lesson ${lesson}` : 'Review before the Final';
      break;
    case 'reading-writing':
      status = 'Reading and writing';
      break;
    case 'weekly-review':
      status = 'Weekly review';
      break;
    case 'checkpoint':
      status = 'Checkpoint test';
      break;
    case 'final':
      status = 'Final B2 exam';
      break;
  }
  const note = behind === 0 ? null : behind === 1 ? "You're one lesson behind the plan" : `You're ${behind} lessons behind the plan`;
  return { date: day, week, dayType: schedule.type, schedule, lesson, expected, behind, status, note, checkpoint };
}
