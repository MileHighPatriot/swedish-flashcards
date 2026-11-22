// Story mode: read a text, listen to it, then answer questions about it by typing Swedish.

import { checkAnswer, type CheckResult } from './check';
import type { ReadingText, TextQuestion } from './texts';

/** Questions asked per story. */
export const STORY_QUESTIONS = 5;

/** Questions that have an answer to check against. One whose answer was never filled in is left out. */
export const askable = (t: ReadingText): TextQuestion[] => t.questions.filter((q) => q.question && q.answers.length > 0);

/** Texts that can be played in Story mode. */
export const storyTexts = (texts: ReadingText[]): ReadingText[] => texts.filter((t) => askable(t).length > 0);

export const gradeStoryAnswer = (typed: string, q: TextQuestion): CheckResult => checkAnswer(typed, q.answers);

export interface StoryAnswer {
  question: TextQuestion;
  typed: string;
  check: CheckResult;
  /** "Count it as right": answers from a text vary, so I can overrule the checker. */
  counted: boolean;
}

export const isRight = (a: StoryAnswer) => a.counted || a.check.verdict !== 'wrong';
export const storyScore = (answers: StoryAnswer[]) => ({ right: answers.filter(isRight).length, total: answers.length });
/** Only the answers I left wrong go on "My mistakes". */
export const storyMisses = (answers: StoryAnswer[]) => answers.filter((a) => !isRight(a) && a.typed.trim());
