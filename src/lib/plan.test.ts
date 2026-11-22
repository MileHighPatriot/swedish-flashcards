import { describe, expect, it } from 'vitest';
import { CHECKPOINTS, PHASES, TOTAL_TARGET_HOURS, WEEK_MAP } from '../data/plan';
import {
  blockWeeks,
  cumulativeTarget,
  currentLesson,
  lessonNumberOf,
  lessonsOfWeek,
  phaseForWeek,
  planPosition,
  targetHours,
  weekForDate,
  weekForLesson,
  weekSessionTags,
} from './plan';

const deck = (lessonNumber: number | null, locked = false) => ({ lessonNumber, locked, deletedAt: null });

describe('the Week Map', () => {
  it('has 58 weeks, Mondays seven days apart, and lessons 6 to 160 with no gap', () => {
    expect(WEEK_MAP.length).toBe(58);
    expect(WEEK_MAP[0]).toEqual({ week: 1, start: '2026-11-23', lessons: [6, 8], checkpoint: null });
    expect(WEEK_MAP[56]).toEqual({ week: 57, start: '2027-12-20', lessons: [159, 160], checkpoint: null });
    expect(WEEK_MAP[57]).toEqual({ week: 58, start: '2027-12-27', lessons: null, checkpoint: 'Final' });
    let next = 6;
    WEEK_MAP.forEach((w, i) => {
      expect(w.week).toBe(i + 1);
      const d = new Date(`${w.start}T12:00:00`);
      expect(d.getDay(), w.start).toBe(1);
      if (i > 0) expect((d.getTime() - new Date(`${WEEK_MAP[i - 1].start}T12:00:00`).getTime()) / 86_400_000).toBeCloseTo(7, 1);
      if (!w.lessons) return;
      expect(w.lessons[0]).toBe(next);
      // Checkpoint weeks and the two holiday weeks have 2 lessons, the rest 3.
      expect(w.lessons[1] - w.lessons[0] + 1).toBe(w.checkpoint || w.week === 5 || w.week === 57 ? 2 : 3);
      next = w.lessons[1] + 1;
    });
    expect(next).toBe(161);
  });

  it('weekForLesson', () => {
    expect([5, 6, 8, 9, 16, 17, 160].map(weekForLesson)).toEqual([0, 1, 1, 2, 4, 5, 57]);
    expect(weekForLesson(1)).toBe(0);
    expect(weekForLesson(37)).toBe(12);
    expect(weekForLesson(38)).toBe(13);
  });

  it('lessonsOfWeek', () => {
    expect(lessonsOfWeek(0)).toEqual([1, 2, 3, 4, 5]);
    expect(lessonsOfWeek(1)).toEqual([6, 7, 8]);
    expect(lessonsOfWeek(4)).toEqual([15, 16]);
    expect(lessonsOfWeek(58)).toEqual([]);
  });

  it('weekForDate', () => {
    expect(['2026-11-22', '2026-11-23', '2026-12-20', '2027-12-27', '2028-01-01'].map(weekForDate)).toEqual([0, 1, 4, 58, 58]);
    expect(weekForDate('2026-11-29')).toBe(1);
    expect(weekForDate('2026-11-30')).toBe(2);
    expect(weekForDate(new Date(2026, 11, 21, 0, 30))).toBe(5);
    expect(weekForDate(new Date(2026, 11, 20, 23, 59).getTime())).toBe(4);
  });

  it('phases', () => {
    expect(PHASES.map((p) => p.weeks)).toEqual([[1, 12], [13, 28], [29, 44], [45, 58]]);
    expect([0, 1, 12, 13, 28, 29, 44, 45, 58].map((w) => phaseForWeek(w)?.phase ?? null)).toEqual([null, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(phaseForWeek(1)!.name).toBe('A2 solid');
    // The phases meet the lesson ranges in the plan: L6–37, L38–81, L82–125, L126–160.
    expect([37, 38, 81, 82, 125, 126].map((l) => phaseForWeek(weekForLesson(l))!.phase)).toEqual([1, 2, 2, 3, 3, 4]);
  });

  it('hours targets: 11 a week, 9 in weeks 5 and 57, 634 in all', () => {
    expect([4, 5, 57].map(targetHours)).toEqual([11, 9, 9]);
    expect(targetHours(0)).toBe(0);
    expect(targetHours(59)).toBe(0);
    expect(cumulativeTarget(1)).toBe(11);
    expect(cumulativeTarget(5)).toBe(53);
    expect(cumulativeTarget(58)).toBe(634);
    expect(TOTAL_TARGET_HOURS).toBe(634);
  });
});

describe('where I am', () => {
  it('the current lesson is the highest lesson among unlocked decks, unless I set it', () => {
    const decks = [deck(null), deck(0), deck(3), deck(5), deck(9, true), { ...deck(12), deletedAt: 1 }];
    expect(currentLesson(decks, { currentLesson: null })).toBe(5);
    expect(currentLesson([...decks, deck(6)], { currentLesson: null })).toBe(6);
    expect(currentLesson(decks, { currentLesson: 14 })).toBe(14);
    expect(currentLesson([], { currentLesson: null })).toBe(0);
  });

  it('content follows the lesson, and the calendar week is reported next to it', () => {
    const behind = planPosition([deck(5)], { currentLesson: null }, new Date(2026, 11, 8, 12).getTime());
    expect(behind).toMatchObject({ lesson: 5, week: 0, phase: null, weekByDate: 3 });
    const onTime = planPosition([deck(13)], { currentLesson: null }, new Date(2026, 11, 8, 12).getTime());
    expect(onTime).toMatchObject({ lesson: 13, week: 3, weekByDate: 3 });
    expect(onTime.phase!.phase).toBe(1);
  });

  it('reads a card’s lesson from its tag first', () => {
    expect(lessonNumberOf({ tags: ['irregular', 'lesson-03', 'lesson-04'], lessonNumber: 4 })).toBe(3);
    expect(lessonNumberOf({ tags: ['verbs'], lessonNumber: 5 })).toBe(5);
    expect(lessonNumberOf({ tags: [], lessonNumber: null })).toBeNull();
  });
});

describe('this week’s lesson', () => {
  const sitting = (cp: string, result: 'pass' | 'close' | 'repeat', over = {}) => ({ cp, kind: 'app' as const, practice: false, result, reviewTag: `review-${cp.toLowerCase()}`, at: 1, deletedAt: null, ...over });

  it('is every lesson of the week', () => {
    expect(weekSessionTags(0, [])).toEqual(['lesson-01', 'lesson-02', 'lesson-03', 'lesson-04', 'lesson-05']);
    expect(weekSessionTags(1, [])).toEqual(['lesson-06', 'lesson-07', 'lesson-08']);
  });

  it('adds the review set of last week’s checkpoint when it came out Close, and only then', () => {
    expect(weekSessionTags(5, [sitting('CP1', 'close')])).toEqual(['lesson-17', 'lesson-18', 'review-cp1']);
    expect(weekSessionTags(5, [sitting('CP1', 'pass')])).toEqual(['lesson-17', 'lesson-18']);
    expect(weekSessionTags(6, [sitting('CP1', 'close')])).toEqual(['lesson-19', 'lesson-20', 'lesson-21']);
    expect(weekSessionTags(5, [sitting('CP1', 'close', { practice: true })])).toEqual(['lesson-17', 'lesson-18']);
    // A later real sitting replaces an earlier one.
    expect(weekSessionTags(5, [sitting('CP1', 'close', { at: 1 }), sitting('CP1', 'pass', { at: 2 })])).toEqual(['lesson-17', 'lesson-18']);
  });
});

describe('checkpoint data', () => {
  it('has the 15 rows of the Checkpoints tab', () => {
    expect(CHECKPOINTS.length).toBe(15);
    expect(CHECKPOINTS[0]).toEqual({ cp: 'CP1', week: 4, date: '2026-12-20', gate: null });
    expect(CHECKPOINTS[14]).toEqual({ cp: 'Final', week: 58, date: '2028-01-01', gate: 'Final B2 exam' });
    expect(CHECKPOINTS.filter((c) => c.gate).map((c) => [c.cp, c.gate])).toEqual([
      ['CP3', 'Phase 1 gate: A2 exit'],
      ['CP7', 'Phase 2 gate: B1 mock'],
      ['CP11', 'Phase 3 gate: B2 entry'],
      ['Final', 'Final B2 exam'],
    ]);
    for (const c of CHECKPOINTS) {
      // Every checkpoint falls in its own plan week, on the Sunday (the Final on the Saturday), and the Week Map agrees.
      expect(weekForDate(c.date), c.cp).toBe(c.week);
      expect(new Date(`${c.date}T12:00:00`).getDay(), c.cp).toBe(c.cp === 'Final' ? 6 : 0);
      expect(WEEK_MAP.find((w) => w.week === c.week)!.checkpoint).toBe(c.cp);
    }
    expect(WEEK_MAP.filter((w) => w.checkpoint).length).toBe(15);
  });

  it('block weeks', () => {
    expect(blockWeeks('CP1')).toEqual([0, 1, 2, 3, 4]);
    expect(blockWeeks('CP2')).toEqual([5, 6, 7, 8]);
    expect(blockWeeks('CP14')).toEqual([53, 54, 55, 56]);
    expect(blockWeeks('Final').length).toBe(59);
    expect(blockWeeks('Final')[0]).toBe(0);
    expect(blockWeeks('nope')).toEqual([]);
  });
});
