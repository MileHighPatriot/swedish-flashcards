import { describe, expect, it } from 'vitest';
import { addDays } from './plan';
import { SEED_PROMPTS, STARTERS, allPrompts, journalForTutor, pickPrompt, type Prompt } from './prompts';

const entry = (date: string, prompt: string) => ({ date, prompt, deletedAt: null });

describe('conversation questions', () => {
  it('are the 11 lines from my lessons, with the starters among them in two-word spelling', () => {
    expect(SEED_PROMPTS.length).toBe(11);
    expect(SEED_PROMPTS[0]).toEqual({ lesson: 1, sv: 'Vad gjorde du i går?', en: 'What did you do yesterday?' });
    expect(SEED_PROMPTS[10]).toEqual({ lesson: 5, sv: 'Hur gammal är din syster?', en: 'How old is your sister?' });
    expect(SEED_PROMPTS.map((p) => p.lesson)).toEqual([1, 1, 2, 3, 4, 4, 4, 5, 5, 5, 5]);
    expect(STARTERS).toEqual(['Vad gjorde du i går?', 'Hur var din dag?', 'Vad gjorde du i helgen?']);
    expect(JSON.stringify([SEED_PROMPTS, STARTERS])).not.toMatch(/igår|idag|imorgon|ikväll/i);
  });

  it('add the questions of imported lessons, once each', () => {
    const lessons = [
      { number: 6, deletedAt: null, questions: [{ sv: 'Kommer du inte?', en: 'Are you not coming?' }, { sv: 'Hur var din dag?', en: 'dup' }] },
      { number: 7, deletedAt: 1, questions: [{ sv: 'Borttagen?', en: '' }] },
    ];
    const all = allPrompts(lessons);
    expect(all.length).toBe(12);
    expect(all[11]).toEqual({ lesson: 6, sv: 'Kommer du inte?', en: 'Are you not coming?' });
    // "Igår" in an imported lesson is the same question as my "i går" one.
    expect(allPrompts([{ number: 9, deletedAt: null, questions: [{ sv: 'Vad gjorde du igår?', en: '' }] }]).length).toBe(11);
  });
});

describe('today’s question', () => {
  const prompts = allPrompts([]);

  it('is the same all day, and for the same date on any device', () => {
    const a = pickPrompt('2026-11-23', prompts, 5, []);
    expect(pickPrompt('2026-11-23', prompts, 5, [])).toEqual(a);
    expect(pickPrompt('2026-11-23', [...prompts], 5, [])).toEqual(a);
    expect(pickPrompt('2026-11-23', [], 5, [])).toBeNull();
  });

  it('comes from my current lesson when that lesson has questions', () => {
    for (let d = 0; d < 30; d++) {
      const date = addDays('2026-11-23', d);
      expect(pickPrompt(date, prompts, 5, [])!.lesson, date).toBe(5);
      expect(pickPrompt(date, prompts, 4, [])!.lesson, date).toBe(4);
    }
    // No question for lesson 6 yet: anything I have.
    expect(pickPrompt('2026-11-23', prompts, 6, [])).not.toBeNull();
    const withSix: Prompt[] = [...prompts, { lesson: 6, sv: 'Kommer du inte?', en: '' }];
    expect(pickPrompt('2026-11-23', withSix, 6, [])!.sv).toBe('Kommer du inte?');
  });

  it('passes over a question from the last 7 days', () => {
    const five = prompts.filter((p) => p.lesson === 5);
    // Walk two weeks, journalling every day: no question repeats within 7 days while others are free.
    const journal: { date: string; prompt: string; deletedAt: null }[] = [];
    for (let d = 0; d < 14; d++) {
      const date = addDays('2026-11-23', d);
      const p = pickPrompt(date, prompts, 5, journal)!;
      const recent = journal.filter((e) => e.date >= addDays(date, -7)).map((e) => e.prompt);
      expect(recent, date).not.toContain(p.sv);
      journal.push(entry(date, p.sv));
    }
    // Once all four lesson-5 questions were used this week, it reaches for an older lesson rather than repeat.
    const used = five.map((p, i) => entry(addDays('2026-12-10', -1 - i), p.sv));
    expect(pickPrompt('2026-12-10', prompts, 5, used)!.lesson).not.toBe(5);
    // Eight days ago no longer counts, and neither does a deleted entry.
    const old = five.map((p) => entry(addDays('2026-12-10', -8), p.sv));
    expect(pickPrompt('2026-12-10', prompts, 5, old)!.lesson).toBe(5);
    expect(pickPrompt('2026-12-10', prompts, 5, used.map((e) => ({ ...e, deletedAt: 1 })))!.lesson).toBe(5);
    // With every question used this week, it still gives one.
    const everything = prompts.map((p, i) => entry(addDays('2026-12-10', -1 - (i % 7)), p.sv));
    expect(pickPrompt('2026-12-10', prompts, 5, everything)).not.toBeNull();
  });
});

describe('copy for my tutor', () => {
  it('has the date, lesson, question in both languages, my answer, and the recording note', () => {
    expect(journalForTutor({ date: '2026-11-23', lessonNumber: 5, prompt: 'Kan du komma på söndag?', promptEn: 'Can you come on Sunday?', text: ' Ja, jag kan komma. ', hasRecording: true })).toBe(
      'Journal 2026-11-23 (Lesson 5)\nQuestion: Kan du komma på söndag? (Can you come on Sunday?)\n\nMy answer:\nJa, jag kan komma.\n\n(recording saved on my phone)',
    );
    expect(journalForTutor({ date: '2026-11-24', lessonNumber: null, prompt: 'Hur var din dag?', promptEn: '', text: 'Bra.', hasRecording: false })).toBe('Journal 2026-11-24\nQuestion: Hur var din dag?\n\nMy answer:\nBra.');
    expect(journalForTutor({ date: '2026-11-24', lessonNumber: 5, prompt: '', promptEn: '', text: '', hasRecording: true })).toBe('Journal 2026-11-24 (Lesson 5)\n\nMy answer:\n(no written answer)\n\n(recording saved on my phone)');
  });
});
