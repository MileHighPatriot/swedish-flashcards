import { describe, expect, it } from 'vitest';
import { CardState, type Card, type ReviewLog } from '../db/types';
import { DAY_MS, newSchedState } from './scheduler';
import { addDays, computeStreak, dayCounts, forecast, heatmap, maturityCounts, retention } from './stats';

const TODAY = '2026-11-16'; // a Monday
const NOW = new Date(2026, 10, 16, 10, 0).getTime();
const meta = (id: string) => ({ id, createdAt: 0, updatedAt: 0, deletedAt: null });
let n = 0;
const log = (at: number, patch: Partial<ReviewLog> = {}): ReviewLog => ({
  ...meta(`r${n++}`), cardId: 'c', noteId: 'n', deckId: 'd', rating: 3, state: CardState.Review, reviewedAt: at, scheduledDays: 1, stability: 1, difficulty: 5, durationMs: 0, cram: false, ...patch,
});
const card = (id: string, patch: Partial<Card> = {}): Card => ({ ...meta(id), ...newSchedState(NOW), noteId: id, deckId: 'd', type: 'basic', suspended: false, leech: false, ...patch });
/** Days studied, given as offsets back from today (0 = today). */
const days = (...back: number[]) => new Set(back.map((b) => addDays(TODAY, -b)));

describe('dayCounts', () => {
  it('groups by study day (4 a.m. rollover) and separates cram', () => {
    const c = dayCounts([log(NOW), log(NOW, { cram: true }), log(new Date(2026, 10, 17, 1, 30).getTime()), log(NOW - DAY_MS), log(NOW, { deletedAt: 1 })], 4);
    expect(c.get('2026-11-16')).toEqual({ all: 3, real: 2 });
    expect(c.get('2026-11-15')).toEqual({ all: 1, real: 1 });
    expect(c.size).toBe(2);
  });
});

describe('computeStreak', () => {
  it('is zero with no history, and counts consecutive days', () => {
    expect(computeStreak(new Set(), TODAY)).toMatchObject({ current: 0, best: 0, activeToday: false });
    expect(computeStreak(days(0, 1, 2), TODAY)).toMatchObject({ current: 3, best: 3, activeToday: true });
  });

  it('does not punish today before it is over', () => {
    expect(computeStreak(days(1, 2, 3), TODAY)).toMatchObject({ current: 3, activeToday: false });
  });

  it('a missed day uses the freeze instead of ending the streak', () => {
    const s = computeStreak(days(0, 1, 3, 4), TODAY); // missed 2 days ago
    expect(s.current).toBe(4);
    expect(s.freezes).toBe(0);
    expect(s.frozenDays).toEqual([addDays(TODAY, -2)]);
  });

  it('a second miss with no freeze left ends the streak, but the best is kept', () => {
    const s = computeStreak(days(0, 2, 4, 5, 6), TODAY); // missed 3 and 1 days ago
    expect(s.current).toBe(1);
    expect(s.best).toBe(4);
    expect(s.frozenDays).toEqual([]);
  });

  it('two missed days in a row need two freezes', () => {
    expect(computeStreak(days(0, 3, 4), TODAY).current).toBe(1);
  });

  it('earns a new freeze every 7 days studied, holding at most 2', () => {
    const week = computeStreak(days(...Array.from({ length: 7 }, (_, i) => i)), TODAY);
    expect(week).toMatchObject({ current: 7, freezes: 2 });
    const month = computeStreak(days(...Array.from({ length: 30 }, (_, i) => i)), TODAY);
    expect(month).toMatchObject({ current: 30, freezes: 2 });
    // 14 days, one miss, 7 more days: the freeze spent is earned back
    const back = [...Array.from({ length: 7 }, (_, i) => i), ...Array.from({ length: 14 }, (_, i) => i + 8)];
    expect(computeStreak(days(...back), TODAY)).toMatchObject({ current: 21, freezes: 2, frozenDays: [addDays(TODAY, -7)] });
  });

  it('a long gap resets, and a freeze is never spent before a streak exists', () => {
    const s = computeStreak(days(0, 1, 40, 41), TODAY);
    expect(s.current).toBe(2);
    expect(s.best).toBe(2);
    expect(s.frozenDays).toEqual([]);
  });

  it('ignores days in the future', () => {
    expect(computeStreak(new Set([TODAY, addDays(TODAY, 3)]), TODAY).current).toBe(1);
  });
});

describe('retention', () => {
  it('is the share of graduated reviews that were remembered', () => {
    const logs = [log(NOW), log(NOW), log(NOW, { rating: 2 }), log(NOW, { rating: 1 }), log(NOW, { rating: 1, state: CardState.New }), log(NOW, { rating: 1, cram: true }), log(NOW - 40 * DAY_MS, { rating: 1 })];
    expect(retention(logs)).toEqual({ total: 5, passed: 3, rate: 0.6 });
    expect(retention(logs, NOW - 30 * DAY_MS)).toEqual({ total: 4, passed: 3, rate: 0.75 });
    expect(retention([]).rate).toBeNull();
  });
});

describe('maturityCounts', () => {
  it('buckets cards as new, learning, young, mature, or suspended', () => {
    const cards = [
      card('a'), card('b'),
      card('c', { state: CardState.Learning }), card('d', { state: CardState.Relearning, scheduledDays: 40 }),
      card('e', { state: CardState.Review, scheduledDays: 3 }),
      card('f', { state: CardState.Review, scheduledDays: 21 }), card('g', { state: CardState.Review, scheduledDays: 90 }),
      card('h', { suspended: true }), card('i', { deletedAt: 1 }),
    ];
    expect(maturityCounts(cards)).toEqual({ new: 2, learning: 2, young: 1, mature: 2, suspended: 1 });
  });
});

describe('forecast', () => {
  it('counts cards by due day, with overdue cards on today', () => {
    const rev = (id: string, due: number, patch: Partial<Card> = {}) => card(id, { state: CardState.Review, due, ...patch });
    const f = forecast(
      [rev('a', NOW - 5 * DAY_MS), rev('b', NOW + 3_600_000), rev('c', NOW + DAY_MS), rev('d', NOW + DAY_MS), rev('e', NOW + 13 * DAY_MS), rev('f', NOW + 20 * DAY_MS), rev('g', NOW, { suspended: true }), card('h'), card('i', { state: CardState.Learning, due: NOW + 60_000 })],
      NOW, 4, 14,
    );
    expect(f).toHaveLength(14);
    expect(f[0]).toEqual({ key: TODAY, count: 3 });
    expect(f[1]).toEqual({ key: '2026-11-17', count: 2 });
    expect(f[13].count).toBe(1);
    expect(f.reduce((s, d) => s + d.count, 0)).toBe(6);
  });
});

describe('heatmap', () => {
  it('lays out whole weeks from Monday, ending with this week', () => {
    const counts = new Map([[TODAY, { all: 10, real: 10 }], ['2026-11-15', { all: 1, real: 1 }], ['2026-11-13', { all: 40, real: 40 }]]);
    const grid = heatmap(counts, TODAY, 3, 20);
    expect(grid).toHaveLength(3);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0][0].key).toBe('2026-11-02');
    expect(grid[2][0]).toEqual({ key: TODAY, count: 10, level: 2, future: false });
    expect(grid[2][1].future).toBe(true);
    expect(grid[1][6]).toMatchObject({ key: '2026-11-15', level: 1 });
    expect(grid[1][4]).toMatchObject({ key: '2026-11-13', count: 40, level: 4 }); // above the goal still tops out
    expect(grid[1][0].level).toBe(0);
  });
});

it('addDays crosses month, year and daylight-saving boundaries', () => {
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
});
