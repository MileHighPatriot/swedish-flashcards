import { describe, expect, it } from 'vitest';
import { resolveToday } from './plan';
import { PRACTICE_TOOLS, SKILLS, suggestedForToday } from './practiceTools';

const pick = (date: string, lesson = 6) => suggestedForToday(resolveToday(date, { lesson })).map((s) => s.title);

describe('practice tools', () => {
  it('each sit under exactly one of the five skills', () => {
    expect(SKILLS).toEqual(['Speaking', 'Listening', 'Reading', 'Writing', 'Grammar']);
    expect(new Set(PRACTICE_TOOLS.map((t) => t.id)).size).toBe(PRACTICE_TOOLS.length);
    expect(Object.fromEntries(SKILLS.map((s) => [s, PRACTICE_TOOLS.filter((t) => t.skill === s).map((t) => t.title)]))).toEqual({
      Speaking: ['Dialogue role-play', 'Free conversation', 'Record and compare'],
      Listening: ['Dictation'],
      Reading: ['Story mode', 'Reader'],
      Writing: ['Journal', 'Sentence builder'],
      Grammar: ['Verbs', 'en or ett'],
    });
  });

  it('suggest by the schedule', () => {
    expect(pick('2026-11-23')).toEqual(['Sentence builder', 'Story mode']); // Mon, Lesson A
    expect(pick('2026-11-24')).toEqual(['Dialogue role-play']); // Tue: speaking
    expect(pick('2026-11-26')).toEqual(['Dialogue role-play']); // Thu: speaking
    expect(pick('2026-11-27', 8)).toEqual(['Sentence builder', 'Journal']); // Fri, Lesson C
    expect(pick('2026-11-28', 8)).toEqual(['Story mode', 'Journal']); // Sat: reading and writing
    expect(pick('2026-11-29', 8)).toEqual(['Weekly review', 'My mistakes']); // Sun
    expect(suggestedForToday(resolveToday('2026-12-20', { lesson: 16 }))).toMatchObject([{ title: 'Checkpoint test', to: '/checkpoints/CP1' }]);
    expect(pick('2026-12-18', 16)).toEqual(['Dialogue role-play']); // short-week Friday is a review day
    expect(pick('2026-11-22', 5)).toEqual(['Sentence builder']); // before the plan
    expect(suggestedForToday(resolveToday('2028-01-01', { lesson: 160 }))[0]).toMatchObject({ title: 'Final B2 exam', to: '/checkpoints/Final' });
  });
});
