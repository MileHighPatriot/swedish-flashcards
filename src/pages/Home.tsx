import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { countToday, getKV, listCards, listDecks, listReviews } from '../db/repo';
import { downloadBackup } from '../lib/backup';
import { computeStreak, dayCounts } from '../lib/stats';
import { CATEGORY_LABELS, DECK_CATEGORIES } from '../db/types';
import { useNow, useSettings } from '../lib/hooks';
import { DAY_MS, studyDayKey, studyDayStart } from '../lib/scheduler';

export function Home() {
  const settings = useSettings();
  const now = useNow();
  const dayStart = studyDayStart(now, settings.dayStartHour);

  const data = useLiveQuery(async () => {
    const [decks, cards, all, lastBackupAt] = await Promise.all([listDecks(), listCards(), listReviews(0), getKV<number>('lastBackupAt')]);
    return { decks, cards, all, logs: all.filter((l) => l.reviewedAt >= dayStart), lastBackupAt };
  }, [dayStart]);

  if (!data) return null;
  const all = countToday(data.cards, data.logs, settings, now);
  const toStudy = all.dueToday + all.newToday;
  const goalDone = Math.min(all.doneToday, settings.dailyGoal);
  const goalPct = Math.round((goalDone / Math.max(1, settings.dailyGoal)) * 100);
  const streak = computeStreak(new Set(dayCounts(data.all, settings.dayStartHour).keys()), studyDayKey(now, settings.dayStartHour));
  const backupDue = data.all.length >= 30 && (!data.lastBackupAt || now - data.lastBackupAt > 14 * DAY_MS);

  return (
    <section>
      <header className="page-head">
        <h1>Hej!</h1>
        <p className="muted">
          {toStudy > 0 ? `${toStudy} cards waiting for you today.` : 'Nothing due right now. Bra jobbat!'}
        </p>
      </header>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-num">{all.dueToday}</span>
          <span className="stat-label">Due today</span>
        </div>
        <div className="stat">
          <span className="stat-num">{all.newToday}</span>
          <span className="stat-label">New today</span>
        </div>
        <Link className="stat stat-link" to="/stats" aria-label={`${streak.current} day streak. Open stats.`}>
          <span className="stat-num">{streak.current}</span>
          <span className="stat-label">Day streak{streak.activeToday ? ' ✓' : ''}</span>
        </Link>
      </div>

      <div
        className="progress"
        role="progressbar"
        aria-label="Daily goal"
        aria-valuemin={0}
        aria-valuemax={settings.dailyGoal}
        aria-valuenow={goalDone}
      >
        <div className="progress-bar" style={{ width: `${goalPct}%` }} />
      </div>
      <p className="muted small">
        Daily goal: {goalDone} of {settings.dailyGoal} reviews
      </p>

      <Link className="btn btn-primary btn-big" to="/study?start=1">
        Start studying
      </Link>
      <Link className="btn btn-big" to="/practice">
        Practice: listen, speak, write, read
      </Link>

      {backupDue && (
        <div className="notice backup-nudge">
          <span>{data.lastBackupAt ? 'It has been over two weeks since your last backup.' : 'You have not made a backup yet.'}</span>
          <button type="button" className="btn btn-small" onClick={() => void downloadBackup()}>
            Download backup
          </button>
        </div>
      )}

      {data.decks.length === 0 && <p className="muted">No decks yet. Add your first lesson to get going.</p>}
      {DECK_CATEGORIES.map((cat) => {
        const decks = data.decks.filter((d) => (d.category ?? 'vocab') === cat);
        if (decks.length === 0) return null;
        return (
          <div key={cat}>
            <h2>{CATEGORY_LABELS[cat]}</h2>
        <ul className="list">
          {decks.map((deck) => {
            const c = countToday(
              data.cards.filter((x) => x.deckId === deck.id),
              data.logs,
              settings,
              now,
            );
            return (
              <li key={deck.id} className="list-item">
                <Link to={deck.locked ? `/words?deck=${deck.id}` : `/study?deck=${deck.id}`} className="list-link">
                  <span className="list-title">{deck.name}</span>
                  <span className="list-meta">
                    {deck.locked ? (
                      <span className="pill pill-locked">Locked</span>
                    ) : (
                      <>
                        <span className="pill pill-due">{c.dueToday} due</span>
                        <span className="pill pill-new">{c.newToday} new</span>
                      </>
                    )}
                    <span className="pill">{data.cards.filter((x) => x.deckId === deck.id).length} cards</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
          </div>
        );
      })}
    </section>
  );
}
