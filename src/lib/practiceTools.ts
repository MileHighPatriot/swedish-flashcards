// The Practice tools, each under one skill, and the pick for today from the Weekly Schedule.

import type { Today } from './plan';

export type Skill = 'Speaking' | 'Listening' | 'Reading' | 'Writing' | 'Grammar';
export const SKILLS: Skill[] = ['Speaking', 'Listening', 'Reading', 'Writing', 'Grammar'];

export interface ToolInfo {
  id: string;
  title: string;
  blurb: string;
  skill: Skill;
  /** Where it opens. The verb drill lives on the Verbs page. */
  to: string;
}

export const PRACTICE_TOOLS: ToolInfo[] = [
  { id: 'dialogue', title: 'Dialogue role-play', blurb: 'Pick a situation, from the café to the in-laws, and play your part.', skill: 'Speaking', to: '/practice/dialogue' },
  { id: 'chat', title: 'Free conversation', blurb: 'Talk freely. A review at the end shows what to fix.', skill: 'Speaking', to: '/practice/chat' },
  { id: 'speak', title: 'Record and compare', blurb: 'Say a sentence, then hear yourself next to the Swedish voice.', skill: 'Speaking', to: '/practice/speak' },
  { id: 'dictation', title: 'Dictation', blurb: 'Hear a sentence, type what you heard.', skill: 'Listening', to: '/practice/dictation' },
  { id: 'story', title: 'Story mode', blurb: 'Read a story, listen to it, then answer questions in Swedish.', skill: 'Reading', to: '/practice/story' },
  { id: 'reader', title: 'Reader', blurb: 'Short texts where every word can be tapped.', skill: 'Reading', to: '/practice/reader' },
  { id: 'journal', title: 'Journal', blurb: 'Answer today’s question. Mistakes come back as fix cards.', skill: 'Writing', to: '/practice/journal' },
  { id: 'builder', title: 'Sentence builder', blurb: 'See a sentence in English, type it in Swedish, word by word feedback.', skill: 'Writing', to: '/practice/builder' },
  { id: 'verbs', title: 'Verbs', blurb: 'The verb table, and a drill on present, past and third form.', skill: 'Grammar', to: '/verbs' },
  { id: 'en-ett', title: 'en or ett', blurb: 'Pick the right article for your nouns.', skill: 'Grammar', to: '/practice/en-ett' },
];

export interface Suggestion {
  to: string;
  title: string;
  why: string;
}

const tool = (id: string, why: string): Suggestion => {
  const t = PRACTICE_TOOLS.find((x) => x.id === id)!;
  return { to: t.to, title: t.title, why };
};

/**
 * "Suggested for today": speaking on Tue and Thu, reading and writing on Sat,
 * the weekly review or the checkpoint on Sun, and the lesson's tools on lesson days.
 */
export function suggestedForToday(today: Today): Suggestion[] {
  switch (today.dayType) {
    case 'review':
      return [tool('dialogue', 'Speaking day: role-play out loud, then speak with Claude for 40 minutes.')];
    case 'reading-writing':
      return [tool('story', 'Saturday is for reading: 45 minutes.'), tool('journal', 'And for writing: 30 minutes.')];
    case 'weekly-review':
      return [{ to: '/progress', title: 'Weekly review', why: 'Sunday: 30 minutes on this week’s hours, checkpoints and misses.' }, { to: '/mistakes', title: 'My mistakes', why: 'Clear what is left for today.' }];
    case 'checkpoint':
    case 'final':
      return [{ to: today.checkpoint ? `/checkpoints/${today.checkpoint.cp}` : '/progress', title: today.dayType === 'final' ? 'Final B2 exam' : 'Checkpoint test', why: 'Today is the test: 75 minutes, four parts.' }];
    case 'lesson':
      return today.schedule?.slot === 'C'
        ? [tool('builder', `Lesson C is the production lesson: build this week’s sentences.`), tool('journal', 'Then write a few of your own.')]
        : [tool('builder', `Lesson ${today.schedule?.slot ?? ''} day: build sentences from this week’s lesson.`), tool('story', 'And read the lesson’s story.')];
    default:
      return [tool('builder', 'A few sentences from English keep recall warm.')];
  }
}
