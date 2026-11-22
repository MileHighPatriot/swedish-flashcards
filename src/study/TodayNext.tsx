import { Link } from 'react-router-dom';
import { nextUp } from '../lib/todayList';
import { useToday } from '../lib/useToday';
import { TodayRow } from '../pages/Home';

/** After a session: what is next on today's list. */
export function TodayNext() {
  const t = useToday();
  if (!t) return null;
  const next = nextUp(t.items);
  return (
    <div className="card today-next">
      <h2>{next ? 'Next on today’s list' : 'Today’s list is done'}</h2>
      <ul className="today-list" aria-label="Today’s list">
        {t.items.map((i) => (
          <TodayRow key={i.id} item={i} next={i === next} />
        ))}
      </ul>
      {!next && (
        <p className="muted small">
          Everything the app can check is done. <Link to="/practice">Extra practice</Link>
        </p>
      )}
    </div>
  );
}
