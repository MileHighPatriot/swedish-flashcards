import { describe, expect, it } from 'vitest';
import { CardState, type Grade, type SchedState } from '../db/types';
import {
  DAY_MS,
  clampRetention,
  createScheduler,
  formatInterval,
  isDueToday,
  isLeech,
  maturity,
  newSchedState,
  studyDayKey,
  studyDayStart,
} from './scheduler';

const T0 = new Date(2026, 10, 16, 10, 0, 0).getTime(); // local 16 Nov 2026 10:00
const make = (retention = 0.9) => createScheduler({ retention, fuzz: false });

/** Rate a card repeatedly, each time exactly when it falls due. */
function run(grades: Grade[], retention = 0.9): { card: SchedState; now: number } {
  const s = make(retention);
  let card = newSchedState(T0);
  let now = T0;
  for (const g of grades) {
    card = s.rate(card, g, now).next;
    now = card.due;
  }
  return { card, now };
}

describe('new cards', () => {
  it('start in the New state, due immediately, with no history', () => {
    const c = newSchedState(T0);
    expect(c.state).toBe(CardState.New);
    expect(c.due).toBe(T0);
    expect(c.reps).toBe(0);
    expect(c.lapses).toBe(0);
    expect(c.lastReview).toBeNull();
  });
});

describe('rate', () => {
  it('does not mutate the input card', () => {
    const c = newSchedState(T0);
    const snapshot = { ...c };
    make().rate(c, 3, T0);
    expect(c).toEqual(snapshot);
  });

  it('moves a new card into learning on Good, due later the same day', () => {
    const { next } = make().rate(newSchedState(T0), 3, T0);
    expect(next.state).toBe(CardState.Learning);
    expect(next.due).toBeGreaterThan(T0);
    expect(next.due - T0).toBeLessThan(DAY_MS);
    expect(next.reps).toBe(1);
    expect(next.lastReview).toBe(T0);
  });

  it('graduates a new card straight to review on Easy', () => {
    const { next } = make().rate(newSchedState(T0), 4, T0);
    expect(next.state).toBe(CardState.Review);
    expect(next.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('graduates after repeated Good answers and intervals keep growing', () => {
    const a = run([3, 3, 3]);
    expect(a.card.state).toBe(CardState.Review);
    const b = run([3, 3, 3, 3]);
    const c = run([3, 3, 3, 3, 3]);
    expect(b.card.scheduledDays).toBeGreaterThan(a.card.scheduledDays);
    expect(c.card.scheduledDays).toBeGreaterThan(b.card.scheduledDays);
  });

  it('counts a lapse and enters relearning when a review card is failed', () => {
    const { card, now } = run([4, 3]);
    expect(card.state).toBe(CardState.Review);
    const { next } = make().rate(card, 1, now);
    expect(next.lapses).toBe(card.lapses + 1);
    expect(next.state).toBe(CardState.Relearning);
    expect(next.due - now).toBeLessThan(DAY_MS);
  });

  it('does not count a lapse for Again on a brand-new card', () => {
    const { next } = make().rate(newSchedState(T0), 1, T0);
    expect(next.lapses).toBe(0);
  });
});

describe('preview', () => {
  it('orders intervals Again <= Hard <= Good <= Easy for a new card', () => {
    const p = make().preview(newSchedState(T0), T0);
    expect(p[1].next.due).toBeLessThanOrEqual(p[2].next.due);
    expect(p[2].next.due).toBeLessThanOrEqual(p[3].next.due);
    expect(p[3].next.due).toBeLessThan(p[4].next.due);
  });

  it('orders intervals for a review card too', () => {
    const { card, now } = run([4, 3, 3]);
    const p = make().preview(card, now);
    expect(p[1].next.due).toBeLessThan(p[2].next.due);
    expect(p[2].next.due).toBeLessThanOrEqual(p[3].next.due);
    expect(p[3].next.due).toBeLessThan(p[4].next.due);
  });

  it('agrees with rate()', () => {
    const { card, now } = run([4, 3]);
    const s = make();
    const p = s.preview(card, now);
    for (const g of [1, 2, 3, 4] as Grade[]) expect(s.rate(card, g, now).next).toEqual(p[g].next);
  });

  it('gives a readable label on every button', () => {
    const p = make().preview(newSchedState(T0), T0);
    for (const g of [1, 2, 3, 4] as Grade[]) expect(p[g].interval).toMatch(/^(<1m|\d+(\.\d)?(m|h|d|mo|y))$/);
  });
});

describe('target retention', () => {
  it('schedules shorter intervals when retention is higher', () => {
    const { card, now } = run([4, 3]);
    const relaxed = createScheduler({ retention: 0.8, fuzz: false }).rate(card, 3, now).next;
    const strict = createScheduler({ retention: 0.95, fuzz: false }).rate(card, 3, now).next;
    expect(strict.scheduledDays).toBeLessThan(relaxed.scheduledDays);
  });

  it('clamps out-of-range values', () => {
    expect(clampRetention(0.2)).toBe(0.7);
    expect(clampRetention(1)).toBe(0.97);
    expect(clampRetention(NaN)).toBe(0.9);
    expect(createScheduler({ retention: 5 }).retention).toBe(0.97);
  });
});

describe('retrievability', () => {
  it('is 0 for new cards and decays over time for review cards', () => {
    const s = make();
    expect(s.retrievability(newSchedState(T0), T0)).toBe(0);
    const { card } = run([4]);
    const soon = s.retrievability(card, card.lastReview! + DAY_MS);
    const later = s.retrievability(card, card.lastReview! + 60 * DAY_MS);
    expect(soon).toBeGreaterThan(later);
    expect(soon).toBeLessThanOrEqual(1);
  });

  it('is close to the target on the due date', () => {
    const { card } = run([4, 3, 3]);
    expect(make().retrievability(card, card.due)).toBeCloseTo(0.9, 1);
  });
});

describe('helpers', () => {
  it('formatInterval', () => {
    expect(formatInterval(20_000)).toBe('<1m');
    expect(formatInterval(10 * 60_000)).toBe('10m');
    expect(formatInterval(3 * 3_600_000)).toBe('3h');
    expect(formatInterval(4 * DAY_MS)).toBe('4d');
    expect(formatInterval(45 * DAY_MS)).toBe('1.5mo');
    expect(formatInterval(60 * DAY_MS)).toBe('2mo');
    expect(formatInterval(730 * DAY_MS)).toBe('2y');
  });

  it('maturity buckets', () => {
    expect(maturity({ state: CardState.New, scheduledDays: 0 })).toBe('new');
    expect(maturity({ state: CardState.Learning, scheduledDays: 0 })).toBe('learning');
    expect(maturity({ state: CardState.Relearning, scheduledDays: 30 })).toBe('learning');
    expect(maturity({ state: CardState.Review, scheduledDays: 5 })).toBe('young');
    expect(maturity({ state: CardState.Review, scheduledDays: 21 })).toBe('mature');
  });

  it('leech threshold', () => {
    expect(isLeech(4, 5)).toBe(false);
    expect(isLeech(5, 5)).toBe(true);
    expect(isLeech(99, 0)).toBe(false); // 0 turns leech detection off
  });

  it('study day rolls over at the configured hour, not midnight', () => {
    const lateNight = new Date(2026, 10, 17, 1, 30).getTime();
    const morning = new Date(2026, 10, 17, 9, 0).getTime();
    expect(studyDayKey(lateNight, 4)).toBe('2026-11-16');
    expect(studyDayKey(morning, 4)).toBe('2026-11-17');
    expect(studyDayStart(lateNight, 4)).toBe(new Date(2026, 10, 16, 4, 0).getTime());
    expect(studyDayStart(morning, 0)).toBe(new Date(2026, 10, 17, 0, 0).getTime());
  });

  it('isDueToday: reviews are due any time on their due day', () => {
    const { card } = run([4]);
    const dueDayMorning = studyDayStart(card.due, 4) + 60_000;
    expect(isDueToday(card, dueDayMorning, 4)).toBe(true);
    expect(isDueToday(card, dueDayMorning - 2 * DAY_MS, 4)).toBe(false);
    expect(isDueToday(newSchedState(T0), T0, 4)).toBe(false);
  });
});
