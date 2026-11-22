import { useLiveQuery } from 'dexie-react-hooks';
import { listCheckpoints, listDecks, listJournal, listMistakeItems, listReviews } from '../db/repo';
import { flashcardMs } from './hours';
import { useNow, useSettings } from './hooks';
import { dueItems, isActive } from './mistakeItems';
import { currentLesson, isoDate, latestSitting, resolveToday, type Today } from './plan';
import { studyDayStart } from './scheduler';
import { todayChecklist, type TodayItem } from './todayList';

/** Today as the plan sees it, with the checklist filled in from what the app already knows. */
export function useToday(): { today: Today; items: TodayItem[]; mistakesLeft: number } | undefined {
  const settings = useSettings();
  const now = useNow();
  const dayStart = studyDayStart(now, settings.dayStartHour);
  const data = useLiveQuery(async () => {
    const [decks, logs, mistakes, checkpoints, journal] = await Promise.all([listDecks(), listReviews(dayStart), listMistakeItems(), listCheckpoints(), listJournal()]);
    return { decks, logs, mistakes, checkpoints, journal };
  }, [dayStart]);
  if (!data) return undefined;
  const today = resolveToday(now, { lesson: currentLesson(data.decks, settings) });
  const mistakesLeft = dueItems(data.mistakes, now, settings.dayStartHour, Infinity).length;
  const items = todayChecklist(today, {
    flashcardMinutes: flashcardMs(data.logs) / 60000,
    mistakesLeft,
    mistakesOpen: data.mistakes.filter(isActive).length,
    journalToday: data.journal.some((e) => e.date === isoDate(now) && e.text.trim() !== ''),
    checkpointTaken: !!today.checkpoint && !!latestSitting(data.checkpoints, today.checkpoint.cp),
  });
  return { today, items, mistakesLeft };
}
