// Thin wrapper around ts-fsrs. The rest of the app only speaks SchedState
// (plain numbers, epoch ms) and never imports ts-fsrs directly.

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card as FsrsCard,
  type FSRS,
  type Grade as FsrsGrade,
} from 'ts-fsrs';
import { CardState, type CardStateValue, type Grade, type SchedState } from '../db/types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_RETENTION = 0.7;
export const MAX_RETENTION = 0.97;
/** Review interval (days) at which a card counts as mature. */
export const MATURE_DAYS = 21;

export const GRADES: Grade[] = [1, 2, 3, 4];
export const GRADE_LABELS: Record<Grade, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

export interface SchedulerOptions {
  /** Desired retention, e.g. 0.9. Clamped to a sane range. */
  retention: number;
  /** Spread due dates slightly so sibling cards don't clump. Off in tests. */
  fuzz?: boolean;
  maximumIntervalDays?: number;
}

export interface RatingOutcome {
  /** The card's scheduling state after the rating. */
  next: SchedState;
  /** Human-readable time until the card is due again, e.g. "10m", "4d". */
  interval: string;
}

export interface Scheduler {
  retention: number;
  /** What each rating would do, without changing anything. */
  preview(card: SchedState, now: number): Record<Grade, RatingOutcome>;
  /** Apply a rating. Returns a new state; the input is not mutated. */
  rate(card: SchedState, grade: Grade, now: number): RatingOutcome;
  /** Estimated chance of recalling the card right now (0-1). */
  retrievability(card: SchedState, now: number): number;
}

export function clampRetention(r: number): number {
  if (!Number.isFinite(r)) return 0.9;
  return Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, r));
}

function toFsrs(s: SchedState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.lastReview == null ? undefined : new Date(s.lastReview),
  };
}

function fromFsrs(c: FsrsCard): SchedState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as CardStateValue,
    lastReview: c.last_review ? c.last_review.getTime() : null,
  };
}

/** Scheduling state for a card that has never been studied. */
export function newSchedState(now: number): SchedState {
  return fromFsrs(createEmptyCard(new Date(now)));
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const retention = clampRetention(opts.retention);
  const engine: FSRS = fsrs(
    generatorParameters({
      request_retention: retention,
      enable_fuzz: opts.fuzz ?? true,
      maximum_interval: opts.maximumIntervalDays ?? 36500,
    }),
  );

  const outcome = (c: FsrsCard, now: number): RatingOutcome => {
    const next = fromFsrs(c);
    return { next, interval: formatInterval(next.due - now) };
  };

  return {
    retention,
    preview(card, now) {
      const p = engine.repeat(toFsrs(card), new Date(now));
      return {
        1: outcome(p[1 as FsrsGrade].card, now),
        2: outcome(p[2 as FsrsGrade].card, now),
        3: outcome(p[3 as FsrsGrade].card, now),
        4: outcome(p[4 as FsrsGrade].card, now),
      };
    },
    rate(card, grade, now) {
      const r = engine.next(toFsrs(card), new Date(now), grade as FsrsGrade);
      return outcome(r.card, now);
    },
    retrievability(card, now) {
      if (card.state === CardState.New) return 0;
      return engine.get_retrievability(toFsrs(card), new Date(now), false);
    },
  };
}

/** "<1m", "10m", "3h", "4d", "2.5mo", "1.2y" */
export function formatInterval(ms: number): string {
  const minutes = ms / 60000;
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${trim(days / 30)}mo`;
  return `${trim(days / 365)}y`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

export type Maturity = 'new' | 'learning' | 'young' | 'mature';

export function maturity(card: Pick<SchedState, 'state' | 'scheduledDays'>): Maturity {
  if (card.state === CardState.New) return 'new';
  if (card.state === CardState.Learning || card.state === CardState.Relearning) return 'learning';
  return card.scheduledDays >= MATURE_DAYS ? 'mature' : 'young';
}

/** A card that keeps being forgotten. Suggest rewriting it. */
export function isLeech(lapses: number, threshold: number): boolean {
  return threshold > 0 && lapses >= threshold;
}

/**
 * Start of the "study day" containing `now`. With dayStartHour = 4, a review
 * at 01:30 still belongs to the previous calendar day.
 */
export function studyDayStart(now: number, dayStartHour: number): number {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), dayStartHour, 0, 0, 0);
  if (start.getTime() > now) start.setDate(start.getDate() - 1);
  return start.getTime();
}

/** End (exclusive) of the study day containing `now`. DST-safe. */
export function studyDayEnd(now: number, dayStartHour: number): number {
  const start = new Date(studyDayStart(now, dayStartHour));
  start.setDate(start.getDate() + 1);
  return start.getTime();
}

/** Local YYYY-MM-DD key for the study day containing `t`. */
export function studyDayKey(t: number, dayStartHour: number): string {
  const d = new Date(studyDayStart(t, dayStartHour));
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Is this card due for study today? Graduated reviews are due any time on
 * their due day; learning steps are due at their exact time (but still count
 * toward today's workload).
 */
export function isDueToday(card: SchedState, now: number, dayStartHour: number): boolean {
  if (card.state === CardState.New) return false;
  return card.due < studyDayEnd(now, dayStartHour);
}
