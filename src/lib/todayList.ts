// Today's short checklist, built from the kind of day it is. An item is marked
// done only where the app can tell (flashcard minutes, mistakes cleared, a
// journal entry, a checkpoint taken). The rest are plain reminders: nothing is
// ticked by hand and nothing is stored.

import { DAILY_FLASHCARD_MINUTES } from '../data/plan';
import type { Today } from './plan';

export interface TodayFacts {
  /** Flashcard minutes so far today. */
  flashcardMinutes: number;
  /** My mistakes still to answer right today, and how many are open in all. */
  mistakesLeft: number;
  mistakesOpen: number;
  /** A journal entry with text exists for today. */
  journalToday: boolean;
  /** Today's checkpoint has a real sitting. */
  checkpointTaken: boolean;
}

export interface TodayItem {
  id: 'cards' | 'mistakes' | 'lesson' | 'speak' | 'write' | 'read' | 'marked' | 'weekly' | 'checkpoint';
  label: string;
  detail: string;
  /** true or false where the app can tell; null for a reminder. */
  done: boolean | null;
  /** Where the item is done in the app. */
  to: string;
}

export function todayChecklist(today: Today, facts: TodayFacts): TodayItem[] {
  const minutes = Math.floor(facts.flashcardMinutes);
  const items: TodayItem[] = [
    { id: 'cards', label: 'Cards', detail: `${minutes} of ${DAILY_FLASHCARD_MINUTES} min`, done: minutes >= DAILY_FLASHCARD_MINUTES, to: '/study?today=1' },
    {
      id: 'mistakes',
      label: 'Mistakes',
      detail: facts.mistakesOpen === 0 ? 'nothing to fix' : facts.mistakesLeft === 0 ? `${facts.mistakesOpen} to fix, done for today` : `${facts.mistakesOpen} to fix, ${facts.mistakesLeft} left today`,
      done: facts.mistakesLeft === 0,
      to: '/mistakes',
    },
  ];
  const write: TodayItem = { id: 'write', label: 'Write', detail: facts.journalToday ? 'journal entry written' : 'a journal entry, 30 min', done: facts.journalToday, to: '/practice/journal' };
  switch (today.dayType) {
    case 'lesson':
      items.push({ id: 'lesson', label: `Lesson ${today.schedule!.slot}`, detail: `with Claude, ${today.schedule!.minutes} min, then add its cards`, done: null, to: '/add' });
      // Lesson C is the production lesson.
      if (today.schedule!.slot === 'C') items.push(write);
      break;
    case 'review':
      items.push({ id: 'speak', label: 'Speak', detail: 'with Claude, 40 min', done: null, to: '/practice/dialogue' });
      items.push({ id: 'marked', label: 'Marked work', detail: 'review it and add the fixes', done: null, to: '/add' });
      break;
    case 'reading-writing':
      items.push({ id: 'read', label: 'Read', detail: 'a story, 45 min', done: null, to: '/practice/story' });
      items.push(write);
      break;
    case 'weekly-review':
      items.push({ id: 'weekly', label: 'Weekly review', detail: '30 min: this week’s progress and misses', done: null, to: '/progress' });
      break;
    case 'checkpoint':
    case 'final':
      items.push({
        id: 'checkpoint',
        label: today.dayType === 'final' ? 'Final B2 exam' : 'Checkpoint test',
        detail: facts.checkpointTaken ? 'taken' : '75 min',
        done: facts.checkpointTaken,
        to: today.checkpoint ? `/checkpoints/${today.checkpoint.cp}` : '/progress',
      });
      break;
  }
  return items;
}

/** What to do next: the first item not done. Reminders count as open. */
export const nextUp = (items: TodayItem[]): TodayItem | null => items.find((i) => i.done !== true) ?? null;
