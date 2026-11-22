import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { addAutoHours, addHours, autoHoursId, getDeviceId, listHours } from '../db/repo';
import { HOURS_CATEGORIES, HOURS_LABELS } from '../db/types';
import { IDLE_MS, createMeter } from './activity';
import { MIN_FLASHCARD_MINUTES, REVIEW_CAP_MS, flashcardMinutesByDate, flashcardMs, formatMinutes, hoursSheetLine, mondayOf, quarter, weekSummary } from './hours';
import { weekForDate } from './plan';

const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime();
const review = (date: string, seconds: number, over = {}) => ({ reviewedAt: at(date), durationMs: seconds * 1000, deletedAt: null, ...over });
const entry = (date: string, category: (typeof HOURS_CATEGORIES)[number], minutes: number, auto = false) => ({ date, category, minutes, auto, deletedAt: null });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});
afterEach(() => vi.useRealTimers());

describe('categories and weeks', () => {
  it('are the five columns of the Hours Log, in order', () => {
    expect(HOURS_CATEGORIES.map((c) => HOURS_LABELS[c])).toEqual(['Lessons and review', 'Speaking', 'Reading and writing', 'Flashcards', 'Own listening']);
    expect(MIN_FLASHCARD_MINUTES).toBe(15);
  });

  it('calendar weeks start on Monday and map to plan weeks', () => {
    expect(mondayOf('2026-11-23')).toBe('2026-11-23');
    expect(mondayOf('2026-11-29')).toBe('2026-11-23');
    expect(mondayOf('2026-11-22')).toBe('2026-11-16');
    expect(mondayOf('2028-01-01')).toBe('2027-12-27');
    expect([mondayOf('2026-11-22'), mondayOf('2026-11-23'), mondayOf('2026-12-27'), mondayOf('2028-01-01')].map(weekForDate)).toEqual([0, 1, 5, 58]);
  });
});

describe('flashcard time from reviews', () => {
  it('caps each review at 60 seconds and sums per day', () => {
    expect(REVIEW_CAP_MS).toBe(60_000);
    const reviews = [review('2026-11-23', 10), review('2026-11-23', 50), review('2026-11-23', 600), review('2026-11-24', 30), review('2026-11-24', 999, { deletedAt: 1 }), review('2026-11-24', -5)];
    expect(flashcardMs(reviews)).toBe(150_000);
    const byDay = flashcardMinutesByDate(reviews);
    expect(byDay.get('2026-11-23')).toBe(2);
    expect(byDay.get('2026-11-24')).toBe(0.5);
    // A review late at night belongs to its own calendar day.
    expect([...flashcardMinutesByDate([{ reviewedAt: new Date(2026, 10, 23, 23, 59).getTime(), durationMs: 30_000, deletedAt: null }]).keys()]).toEqual(['2026-11-23']);
  });
});

describe('a week', () => {
  const input = {
    entries: [
      entry('2026-11-23', 'lessons', 100),
      entry('2026-11-25', 'lessons', 100),
      entry('2026-11-24', 'speaking', 40),
      entry('2026-11-24', 'speaking', 12, true),
      entry('2026-11-28', 'reading-writing', 75),
      entry('2026-11-29', 'listening', 90),
      entry('2026-11-30', 'lessons', 100), // next week
      entry('2026-11-20', 'lessons', 60), // before the plan
      { ...entry('2026-11-26', 'lessons', 500), deletedAt: 1 },
    ],
    reviews: [review('2026-11-23', 60), review('2026-11-23', 60), review('2026-11-29', 30), review('2026-12-01', 60), review('2026-11-21', 60)],
    countAuto: true,
  };

  it('adds up each category, the total against the target, and the running totals against the plan', () => {
    const w = weekSummary(input, '2026-11-23');
    expect(w).toMatchObject({ monday: '2026-11-23', sunday: '2026-11-29', week: 1, targetHours: 11, cumulativeTarget: 11, overallTarget: 634 });
    expect(w.minutes).toEqual({ lessons: 200, speaking: 52, 'reading-writing': 75, flashcards: 2.5, listening: 90 });
    expect(w.autoMinutes).toEqual({ lessons: 0, speaking: 12, 'reading-writing': 0, flashcards: 2.5, listening: 0 });
    expect(w.totalHours).toBeCloseTo(419.5 / 60, 6);
    expect(w.cumulativeHours).toBeCloseTo(419.5 / 60, 6);
    // The whole plan so far: this week plus next week's lesson and review. Nothing from before 23 November.
    expect(w.overallHours).toBeCloseTo((419.5 + 100 + 1) / 60, 6);

    const next = weekSummary(input, '2026-11-30');
    expect(next).toMatchObject({ week: 2, targetHours: 11, cumulativeTarget: 22 });
    expect(next.cumulativeHours).toBeCloseTo(520.5 / 60, 6);
    expect(weekSummary(input, '2026-12-21')).toMatchObject({ week: 5, targetHours: 9, cumulativeTarget: 53 });
    expect(weekSummary(input, '2027-12-20')).toMatchObject({ week: 57, targetHours: 9, cumulativeTarget: 623 });
    expect(weekSummary(input, '2027-12-27')).toMatchObject({ week: 58, targetHours: 11, cumulativeTarget: 634 });
    // Before the plan there is no target; what I logged still shows.
    const before = weekSummary(input, '2026-11-16');
    expect(before).toMatchObject({ week: 0, targetHours: 0, cumulativeTarget: 0, cumulativeHours: 0 });
    expect(before.minutes.lessons).toBe(60);
  });

  it('can leave out the practice time the app logged by itself', () => {
    const w = weekSummary({ ...input, countAuto: false }, '2026-11-23');
    expect(w.minutes.speaking).toBe(40);
    expect(w.autoMinutes.speaking).toBe(12);
    // Flashcard time comes from the reviews and always counts.
    expect(w.minutes.flashcards).toBe(2.5);
  });

  it('copies the five category hours as one tab-separated line, rounded to a quarter', () => {
    expect(quarter(100)).toBe(1.75);
    expect(quarter(52)).toBe(0.75);
    expect(quarter(7)).toBe(0);
    expect(quarter(8)).toBe(0.25);
    expect(hoursSheetLine(weekSummary(input, '2026-11-23').minutes)).toBe('3.25\t0.75\t1.25\t0\t1.5');
    expect(formatMinutes(75)).toBe('1 h 15 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(40.4)).toBe('40 min');
  });
});

describe('active time in a practice tool', () => {
  it('counts while I keep interacting and stops 60 seconds after the last touch', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2026-11-23'));
    const m = createMeter(Date.now());
    const pass = (ms: number) => vi.advanceTimersByTime(ms);
    pass(30_000);
    m.touch(Date.now()); // 30 s in
    pass(30_000);
    m.touch(Date.now()); // 60 s in
    expect(m.take(Date.now())).toBe(60_000);
    // I walk away: only the first 60 seconds of the next ten minutes count.
    pass(10 * 60_000);
    expect(IDLE_MS).toBe(60_000);
    expect(m.take(Date.now())).toBe(60_000);
    pass(60_000);
    expect(m.take(Date.now())).toBe(0);
    // Back again: the clock restarts from the touch, not from when I left.
    m.touch(Date.now());
    pass(20_000);
    expect(m.take(Date.now())).toBe(20_000);
  });

  it('does not count while the screen is hidden', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2026-11-23'));
    const m = createMeter(Date.now());
    vi.advanceTimersByTime(10_000);
    m.setVisible(false, Date.now());
    vi.advanceTimersByTime(40_000);
    m.setVisible(true, Date.now());
    vi.advanceTimersByTime(5_000);
    expect(m.take(Date.now())).toBe(15_000);
  });

  it('is stored as one row per day, category and device', async () => {
    const device = await getDeviceId();
    expect(await getDeviceId()).toBe(device);
    expect(autoHoursId('abc', '2026-11-23', 'speaking')).toBe('auto:abc:2026-11-23:speaking');
    await addAutoHours('2026-11-23', 'speaking', 90_000);
    await addAutoHours('2026-11-23', 'speaking', 45_000);
    await addAutoHours('2026-11-23', 'lessons', 60_000);
    await addAutoHours('2026-11-24', 'speaking', 30_000);
    await addAutoHours('2026-11-24', 'speaking', 0);
    const rows = await listHours();
    expect(rows.map((r) => [r.id, r.minutes, r.auto])).toEqual([
      [`auto:${device}:2026-11-23:speaking`, 2.25, true],
      [`auto:${device}:2026-11-23:lessons`, 1, true],
      [`auto:${device}:2026-11-24:speaking`, 0.5, true],
    ]);
    // A second device writes its own rows next to these; a manual entry is separate again.
    await db.kv.delete('deviceId');
    const other = await getDeviceId();
    expect(other).not.toBe(device);
    await addAutoHours('2026-11-23', 'speaking', 60_000);
    await addHours({ date: '2026-11-23', category: 'speaking', minutes: 40 });
    const speaking = (await listHours()).filter((r) => r.date === '2026-11-23' && r.category === 'speaking');
    expect(speaking.length).toBe(3);
    expect(weekSummary({ entries: await listHours(), reviews: [], countAuto: true }, '2026-11-23').minutes.speaking).toBe(43.75); // 2.25 + 1 + 40 on the 23rd, 0.5 on the 24th
  });
});
