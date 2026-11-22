import { describe, expect, it } from 'vitest';
import { CHECKPOINTS, WEEKLY_SCHEDULE, WEEK_MAP } from '../data/plan';
import { expectedLesson, isShortWeek, resolveToday, scheduleOfWeek, weekdayOf } from './plan';

const at = (date: string, lesson: number) => resolveToday(date, { lesson });

describe('the Weekly Schedule', () => {
  it('is Mon, Wed, Fri lessons of 100 min; Tue, Thu 75; Sat 90; Sun 45', () => {
    expect(WEEKLY_SCHEDULE.map((d) => [d.name, d.type, d.slot, d.minutes])).toEqual([
      ['Mon', 'lesson', 'A', 100],
      ['Tue', 'review', null, 75],
      ['Wed', 'lesson', 'B', 100],
      ['Thu', 'review', null, 75],
      ['Fri', 'lesson', 'C', 100],
      ['Sat', 'reading-writing', null, 90],
      ['Sun', 'weekly-review', null, 45],
    ]);
    expect(weekdayOf('2026-11-23')).toBe(1);
    expect(weekdayOf('2026-12-20')).toBe(7);
    expect(weekdayOf('2028-01-01')).toBe(6);
  });

  it('agrees with the Week Map in every week: 3 lessons, or 2 in weeks 4, 8, … 56 and 5 and 57, and none in week 58', () => {
    const short = [5, 57, ...Array.from({ length: 14 }, (_, i) => 4 * (i + 1))];
    for (const w of WEEK_MAP) {
      const lessonDays = scheduleOfWeek(w.week).filter((d) => d.type === 'lesson').length;
      const want = w.week === 58 ? 0 : short.includes(w.week) ? 2 : 3;
      expect(lessonDays, `week ${w.week}`).toBe(want);
      // The schedule and the Week Map must tell the same story.
      expect(w.lessons ? w.lessons[1] - w.lessons[0] + 1 : 0, `week ${w.week} in the Week Map`).toBe(want);
      expect(isShortWeek(w.week)).toBe(want === 2);
      expect(scheduleOfWeek(w.week).length).toBe(7);
    }
    // Checkpoint Sundays are checkpoint tests, the others weekly reviews.
    for (const w of WEEK_MAP) expect(scheduleOfWeek(w.week)[6].type, `week ${w.week}`).toBe(w.checkpoint && w.checkpoint !== 'Final' ? 'checkpoint' : 'weekly-review');
    for (const c of CHECKPOINTS) expect(resolveToday(c.date, { lesson: 160 }).dayType, c.cp).toBe(c.cp === 'Final' ? 'final' : 'checkpoint');
  });

  it('knows which lesson the plan has reached on any day', () => {
    expect(expectedLesson('2026-11-22')).toBe(5);
    expect(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-29'].map(expectedLesson)).toEqual([6, 6, 7, 7, 8, 8]);
    expect(expectedLesson('2026-11-30')).toBe(9);
    // Week 4 is short: Friday brings no new lesson.
    expect(['2026-12-14', '2026-12-16', '2026-12-18', '2026-12-20'].map(expectedLesson)).toEqual([15, 16, 16, 16]);
    expect(expectedLesson('2027-12-27')).toBe(160);
    expect(expectedLesson('2028-01-01')).toBe(160);
  });
});

describe('resolveToday', () => {
  it('Mon 2026-11-23 with Lesson 6 unlocked reads "Lesson 6, day 1"', () => {
    expect(at('2026-11-23', 6)).toMatchObject({ week: 1, dayType: 'lesson', lesson: 6, status: 'Lesson 6, day 1', note: null, behind: 0 });
    expect(at('2026-11-23', 6).schedule).toMatchObject({ slot: 'A', minutes: 100 });
  });

  it('Tue 2026-11-24 reads "Review of Lesson 6"', () => {
    expect(at('2026-11-24', 6)).toMatchObject({ week: 1, dayType: 'review', status: 'Review of Lesson 6', note: null });
  });

  it('Sun 2026-11-22 reads "Plan starts tomorrow", earlier dates "Plan starts Mon Nov 23", and never "Week 0"', () => {
    expect(at('2026-11-22', 5)).toMatchObject({ dayType: null, status: 'Plan starts tomorrow', note: null, lesson: null });
    expect(at('2026-11-21', 5).status).toBe('Plan starts Mon Nov 23');
    expect(at('2026-10-01', 3).status).toBe('Plan starts Mon Nov 23');
    for (const d of ['2026-11-22', '2026-11-01', '2026-11-23', '2028-01-01']) expect(JSON.stringify(at(d, 5).status + at(d, 5).note)).not.toMatch(/week 0/i);
  });

  it('Fri 2026-12-18 (week 4) is a review day, and Sun 2026-12-20 is "Checkpoint test"', () => {
    expect(at('2026-12-18', 16)).toMatchObject({ week: 4, dayType: 'review', status: 'Review of Lesson 16', note: null });
    const sunday = at('2026-12-20', 16);
    expect(sunday).toMatchObject({ week: 4, dayType: 'checkpoint', status: 'Checkpoint test' });
    expect(sunday.checkpoint).toMatchObject({ cp: 'CP1', date: '2026-12-20' });
    expect(sunday.schedule!.minutes).toBe(75);
    // An ordinary Sunday is the weekly review, 45 minutes.
    expect(at('2026-11-29', 8)).toMatchObject({ dayType: 'weekly-review', status: 'Weekly review' });
    expect(at('2026-11-29', 8).schedule!.minutes).toBe(45);
  });

  it('a week 5 Friday is a review day', () => {
    expect(at('2026-12-25', 18)).toMatchObject({ week: 5, dayType: 'review', status: 'Review of Lesson 18' });
    expect(at('2027-12-24', 160)).toMatchObject({ week: 57, dayType: 'review' });
    // A regular Friday is Lesson C.
    expect(at('2026-11-27', 8)).toMatchObject({ dayType: 'lesson', status: 'Lesson 8, day 5' });
    expect(at('2026-11-27', 8).schedule!.slot).toBe('C');
  });

  it('a date in week 58 has no lesson, and Sat 2028-01-01 is the Final', () => {
    for (const d of ['2027-12-27', '2027-12-29', '2027-12-31']) {
      expect(at(d, 160), d).toMatchObject({ week: 58, dayType: 'review', status: 'Review before the Final' });
      expect(at(d, 160).schedule!.slot).toBeNull();
    }
    expect(at('2028-01-01', 160)).toMatchObject({ week: 58, dayType: 'final', status: 'Final B2 exam' });
    expect(at('2028-01-01', 160).checkpoint!.cp).toBe('Final');
    expect(at('2028-01-02', 160)).toMatchObject({ dayType: null, status: 'The plan is finished' });
  });

  it('progress short of the plan shows the behind note', () => {
    expect(at('2026-11-25', 6)).toMatchObject({ expected: 7, behind: 1, status: 'Lesson 6, day 3', note: "You're one lesson behind the plan" });
    expect(at('2026-11-27', 6)).toMatchObject({ expected: 8, behind: 2, note: "You're 2 lessons behind the plan" });
    expect(at('2026-11-24', 5)).toMatchObject({ behind: 1, status: 'Review of Lesson 5', note: "You're one lesson behind the plan" });
    // On time or ahead: no note.
    expect(at('2026-11-25', 7).note).toBeNull();
    expect(at('2026-11-25', 9)).toMatchObject({ behind: 0, note: null, status: 'Lesson 9, day 3' });
  });

  it('takes a Date or a timestamp in local time', () => {
    expect(resolveToday(new Date(2026, 10, 23, 0, 5), { lesson: 6 }).status).toBe('Lesson 6, day 1');
    expect(resolveToday(new Date(2026, 10, 23, 23, 55).getTime(), { lesson: 6 }).status).toBe('Lesson 6, day 1');
    expect(resolveToday(new Date(2026, 10, 22, 23, 55), { lesson: 5 }).status).toBe('Plan starts tomorrow');
  });
});
