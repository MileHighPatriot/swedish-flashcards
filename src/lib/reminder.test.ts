import { describe, expect, it } from 'vitest';
import { minutesOf, reminderDue } from './reminder';

const at = (h: number, m = 0, day = 16) => new Date(2026, 10, day, h, m).getTime();
const on = { reminderEnabled: true, reminderTime: '19:00', dayStartHour: 4 };

describe('reminderDue', () => {
  it('fires once at or after the chosen time', () => {
    expect(reminderDue(on, at(18, 59), null)).toBe(false);
    expect(reminderDue(on, at(19, 0), null)).toBe(true);
    expect(reminderDue(on, at(22, 30), null)).toBe(true);
    expect(reminderDue(on, at(22, 30), '2026-11-16')).toBe(false); // already fired today
    expect(reminderDue(on, at(19, 5, 17), '2026-11-16')).toBe(true); // next day
  });
  it('stays quiet when switched off, and in the small hours before the day rolls over', () => {
    expect(reminderDue({ ...on, reminderEnabled: false }, at(20), null)).toBe(false);
    expect(reminderDue({ ...on, reminderTime: '00:30' }, at(1, 0), null)).toBe(false);
    expect(reminderDue({ ...on, reminderTime: '07:15' }, at(7, 15), null)).toBe(true);
  });
  it('reads HH:MM, with a sane fallback', () => {
    expect(minutesOf('07:15')).toBe(435);
    expect(minutesOf('')).toBe(19 * 60);
  });
});
