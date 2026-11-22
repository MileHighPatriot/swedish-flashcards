import { describe, expect, it } from 'vitest';
import { resolveToday } from './plan';
import { nextUp, todayChecklist, type TodayFacts } from './todayList';

const facts = (over: Partial<TodayFacts> = {}): TodayFacts => ({ flashcardMinutes: 0, mistakesLeft: 4, mistakesOpen: 20, journalToday: false, checkpointTaken: false, ...over });
const list = (date: string, lesson: number, f: Partial<TodayFacts> = {}) => todayChecklist(resolveToday(date, { lesson }), facts(f));
const ids = (date: string, lesson = 6) => list(date, lesson).map((i) => i.id);

describe('today’s checklist', () => {
  it('always starts with Cards against 15 minutes and Mistakes', () => {
    const [cards, mistakes] = list('2026-11-23', 6, { flashcardMinutes: 7.9 });
    expect(cards).toMatchObject({ id: 'cards', detail: '7 of 15 min', done: false, to: '/study?today=1' });
    expect(mistakes).toMatchObject({ id: 'mistakes', detail: '20 to fix, 4 left today', done: false });
    expect(list('2026-11-23', 6, { flashcardMinutes: 15 })[0]).toMatchObject({ detail: '15 of 15 min', done: true });
    expect(list('2026-11-23', 6, { mistakesLeft: 0 })[1]).toMatchObject({ detail: '20 to fix, done for today', done: true });
    expect(list('2026-11-23', 6, { mistakesLeft: 0, mistakesOpen: 0 })[1]).toMatchObject({ detail: 'nothing to fix', done: true });
  });

  it('adds what the day calls for', () => {
    expect(ids('2026-11-23')).toEqual(['cards', 'mistakes', 'lesson']); // Mon: Lesson A
    expect(ids('2026-11-24')).toEqual(['cards', 'mistakes', 'speak', 'marked']); // Tue
    expect(ids('2026-11-27', 8)).toEqual(['cards', 'mistakes', 'lesson', 'write']); // Fri: Lesson C, production
    expect(ids('2026-11-28', 8)).toEqual(['cards', 'mistakes', 'read', 'write']); // Sat
    expect(ids('2026-11-29', 8)).toEqual(['cards', 'mistakes', 'weekly']); // Sun
    expect(ids('2026-12-18', 16)).toEqual(['cards', 'mistakes', 'speak', 'marked']); // short-week Friday: review
    expect(ids('2026-12-20', 16)).toEqual(['cards', 'mistakes', 'checkpoint']);
    expect(ids('2026-11-22', 5)).toEqual(['cards', 'mistakes']); // before the plan
    expect(list('2026-11-23', 6)[2]).toMatchObject({ label: 'Lesson A', done: null, to: '/add' });
    expect(list('2026-12-20', 16)[2]).toMatchObject({ label: 'Checkpoint test', detail: '75 min', done: false, to: '/checkpoints/CP1' });
    expect(list('2028-01-01', 160)[2]).toMatchObject({ label: 'Final B2 exam', to: '/checkpoints/Final' });
    // Never more than four rows, so the list fits on the phone.
    for (let d = 0; d < 60; d++) expect(list(new Date(2026, 10, 20 + d).toISOString().slice(0, 10), 6).length).toBeLessThanOrEqual(4);
  });

  it('marks done only what the app can tell, and leaves the rest as reminders', () => {
    const sat = list('2026-11-28', 8, { journalToday: true, flashcardMinutes: 20, mistakesLeft: 0 });
    expect(sat.map((i) => [i.id, i.done])).toEqual([
      ['cards', true],
      ['mistakes', true],
      ['read', null],
      ['write', true],
    ]);
    expect(list('2026-12-20', 16, { checkpointTaken: true })[2]).toMatchObject({ done: true, detail: 'taken' });
    expect(list('2026-11-24', 6).filter((i) => i.done === null).map((i) => i.id)).toEqual(['speak', 'marked']);
  });

  it('says what is next: the first thing not done', () => {
    expect(nextUp(list('2026-11-28', 8))!.id).toBe('cards');
    expect(nextUp(list('2026-11-28', 8, { flashcardMinutes: 15 }))!.id).toBe('mistakes');
    expect(nextUp(list('2026-11-28', 8, { flashcardMinutes: 15, mistakesLeft: 0 }))!.id).toBe('read');
    expect(nextUp(list('2026-11-22', 5, { flashcardMinutes: 15, mistakesLeft: 0 }))).toBeNull();
  });
});
