import { describe, expect, it } from 'vitest';
import { askable, gradeStoryAnswer, isRight, storyMisses, storyScore, storyTexts, type StoryAnswer } from './story';
import { BUILT_IN_TEXTS, SITUATIONS, isDialogue, parseText } from './texts';

describe('question lines in a text', () => {
  const text = parseText(
    ['# Lesson 04 – Min lördag', 'I lördags vaknade jag klockan åtta. | Last Saturday I woke up at eight.', '? När vaknade jag? | Du vaknade klockan åtta. // Jag vaknade klockan åtta. | 1', '?  Utan svar | | ', 'Vad gjorde du? | What did you do?'].join('\n'),
    't',
  );

  it('are read as questions and never shown as lines of the text', () => {
    expect(text.lines.map((l) => l.sv)).toEqual(['I lördags vaknade jag klockan åtta.', 'Vad gjorde du?']);
    expect(text.questions).toEqual([
      { question: 'När vaknade jag?', answers: ['Du vaknade klockan åtta.', 'Jag vaknade klockan åtta.'], line: 1 },
      { question: 'Utan svar', answers: [], line: null },
    ]);
    // A question with no answer filled in is not asked.
    expect(askable(text).map((q) => q.question)).toEqual(['När vaknade jag?']);
  });

  it('an ordinary sentence that ends in a question mark is still a line', () => {
    expect(parseText('Vad gjorde du i går? | What did you do yesterday?', 'x').questions).toEqual([]);
  });
});

describe('the built-in stories', () => {
  const stories = storyTexts(BUILT_IN_TEXTS);
  const lordag = stories.find((t) => t.id === 'seed:04-story-min-lordag')!;
  const erik = stories.find((t) => t.id === 'seed:05-story-eriks-helg')!;

  it('Min lördag and Eriks helg each have five questions, and the texts keep their lines', () => {
    expect(stories.map((t) => t.id)).toEqual(['seed:04-story-min-lordag', 'seed:05-story-eriks-helg']);
    expect(lordag).toMatchObject({ title: 'Min lördag', lesson: 4 });
    expect(lordag.lines.length).toBe(8);
    expect(erik.lines.length).toBe(7);
    expect(askable(lordag).length).toBe(5);
    expect(askable(erik).length).toBe(5);
    expect(isDialogue(lordag)).toBe(false);
    // No other text or role-play situation grew a question or lost a line to one.
    expect([...BUILT_IN_TEXTS, ...SITUATIONS].filter((t) => t.questions.length > 0).length).toBe(2);
  });

  it('every listed answer is accepted, and each question points at a real line', () => {
    for (const t of stories)
      for (const q of askable(t)) {
        for (const a of q.answers) expect(gradeStoryAnswer(a, q).verdict, a).toBe('correct');
        expect(q.line).toBeGreaterThan(0);
        expect(t.lines[q.line! - 1], q.question).toBeTruthy();
      }
    const q = askable(lordag)[0];
    expect(q).toEqual({ question: 'När vaknade jag?', answers: ['Du vaknade klockan åtta.', 'Jag vaknade klockan åtta.', 'I lördags vaknade du klockan åtta.', 'I lördags vaknade jag klockan åtta.'], line: 1 });
    expect(gradeStoryAnswer('jag vaknade klockan åtta', q).verdict).toBe('correct');
    expect(gradeStoryAnswer('Jag vaknade klockan atta', q).verdict).toBe('close');
    const miss = gradeStoryAnswer('Jag vaknade klockan sju.', q);
    expect(miss.verdict).toBe('wrong');
    expect(miss.expected).toBe('Jag vaknade klockan åtta.');
    expect(askable(erik)[4]).toEqual({ question: 'Vem ska de träffa på söndag?', answers: ['De ska träffa Annas mamma.', 'På söndag ska de träffa Annas mamma.'], line: 5 });
  });

  it('only answers left wrong become mistakes', () => {
    const [q1, q2, q3, q4] = askable(lordag);
    const answer = (q: typeof q1, typed: string, counted = false): StoryAnswer => ({ question: q, typed, check: gradeStoryAnswer(typed, q), counted });
    const answers = [answer(q1, 'Jag vaknade klockan åtta.'), answer(q2, 'Jag drack te.'), answer(q3, 'Svärmor ringde.', true), answer(q4, '')];
    expect(answers.map(isRight)).toEqual([true, false, true, false]);
    expect(storyScore(answers)).toEqual({ right: 2, total: 4 });
    // Counted-as-right is not a mistake, and neither is a question I skipped without typing.
    expect(storyMisses(answers).map((a) => a.typed)).toEqual(['Jag drack te.']);
  });
});
