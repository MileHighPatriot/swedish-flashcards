import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { getKV, listCheckpoints, listReviews } from '../db/repo';
import { downloadBackup } from '../lib/backup';
import { checkpointTitle, openCheckpoint } from '../lib/checkpoint';
import { useNow } from '../lib/hooks';
import { DAY_MS } from '../lib/scheduler';
import { nextUp, type TodayItem } from '../lib/todayList';
import { useToday } from '../lib/useToday';

/** One row of today's list: a tick where the app can tell, a plain dot for a reminder. */
export function TodayRow({ item, next }: { item: TodayItem; next: boolean }) {
  const state = item.done === true ? 'Done' : item.done === false ? 'To do' : 'Reminder';
  return (
    <li>
      <Link className={`today-item ${item.done === true ? 'is-done' : ''} ${next ? 'is-next' : ''}`} to={item.to}>
        <span className="today-mark" aria-hidden="true">
          {item.done === true ? '✓' : item.done === false ? '○' : '·'}
        </span>
        <span className="today-text">
          <strong>{item.label}</strong> <span className="today-detail">{item.detail}</span>
        </span>
        <span className="sr-only">. {state}.</span>
        {next && <span className="pill pill-tag">next</span>}
      </Link>
    </li>
  );
}

export function Home() {
  const now = useNow();
  const t = useToday();
  const more = useLiveQuery(async () => {
    const [checkpoints, reviews, lastBackupAt] = await Promise.all([listCheckpoints(), listReviews(0), getKV<number>('lastBackupAt')]);
    return { checkpoints, reviews: reviews.length, lastBackupAt };
  }, []);
  if (!t) return null;
  const { today, items } = t;
  const next = nextUp(items);
  const checkpoint = more ? openCheckpoint(now, more.checkpoints) : null;
  const backupDue = !!more && more.reviews >= 30 && (!more.lastBackupAt || now - more.lastBackupAt > 14 * DAY_MS);
  const dateLine = new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <section className="today">
      <header className="page-head today-head">
        <h1>Today</h1>
        <p className="muted">
          {dateLine}
          {today.week >= 1 && today.dayType ? ` · Week ${today.week}` : ''}
        </p>
      </header>

      <Link className="btn btn-primary btn-big today-start" to="/study?today=1">
        Start today’s session
      </Link>
      <p className="today-status">
        <strong>{today.status}</strong>
        {today.schedule ? <span className="muted"> · {today.schedule.minutes} min planned</span> : null}
      </p>
      {today.note && <p className="today-note">{today.note}</p>}

      <ul className="today-list" aria-label="Today’s list">
        {items.map((i) => (
          <TodayRow key={i.id} item={i} next={i === next} />
        ))}
      </ul>

      {checkpoint && today.dayType !== 'checkpoint' && today.dayType !== 'final' && (
        <p className="notice">
          <strong>
            {checkpointTitle(checkpoint.cp.cp)}: {checkpoint.state === 'not-taken' ? 'not taken yet' : `this week, on ${new Date(`${checkpoint.cp.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`}
          </strong>{' '}
          <Link to="/progress">Open checkpoints</Link>
        </p>
      )}

      {backupDue && (
        <div className="notice backup-nudge">
          <span>{more?.lastBackupAt ? 'It has been over two weeks since your last backup.' : 'You have not made a backup yet.'}</span>
          <button type="button" className="btn btn-small" onClick={() => void downloadBackup()}>
            Download backup
          </button>
        </div>
      )}

      <nav className="today-links" aria-label="More for today">
        <Link to="/study?week=1">This week’s lesson</Link>
        <Link to="/mistakes">My mistakes</Link>
        <Link to="/practice">Practice</Link>
        <Link to="/decks">Decks</Link>
      </nav>
    </section>
  );
}
