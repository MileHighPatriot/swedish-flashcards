import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { listMistakeItems, listNotes, removeMistakeItem } from '../db/repo';
import type { MistakeItem } from '../db/types';
import { useNow, useSettings } from '../lib/hooks';
import { dayCount, dueItems, isActive } from '../lib/mistakeItems';
import { splitAlternatives } from '../lib/parser';
import { buildReasonContext } from '../lib/reasons';
import { MistakeRound, type RoundSummary } from '../study/MistakeRound';

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function Item({ item }: { item: MistakeItem }) {
  const [first, ...others] = splitAlternatives(item.correct);
  const retired = item.retiredAt != null;
  return (
    <li className="list-item word">
      <div className="word-main">
        <span className="word-sv">{item.prompt}</span>
        <span className={`pill ${retired ? 'pill-new' : 'pill-warn'}`}>{retired ? `Fixed ${day(item.retiredAt!)}` : dayCount(item)}</span>
      </div>
      {item.typed && (
        <div className="mistake-line" lang="sv">
          <span className="verdict-label">You wrote</span> <span className="seg-bad">{item.typed}</span>
        </div>
      )}
      <div className="mistake-line" lang="sv">
        <span className="verdict-label">Correct</span> <span className="seg-miss">{first}</span>
        {others.length > 0 && <span className="muted small"> · also: {others.join(' · ')}</span>}
      </div>
      {item.reason && (
        <div className="mistake-line">
          <span className="verdict-label">Why</span> {item.reason}
        </div>
      )}
      <div className="word-foot">
        <div className="word-tags">
          <span className="pill">wrong {item.timesWrong}×</span>
          {item.tags.map((t) => (
            <span key={t} className="pill pill-tag">
              #{t}
            </span>
          ))}
        </div>
        <div className="actions">
          {item.noteId && (
            <Link className="btn btn-small" to={`/edit/${item.noteId}`}>
              Card
            </Link>
          )}
          <button
            type="button"
            className="btn btn-small"
            aria-label={`Remove “${item.prompt}” from my mistakes`}
            onClick={() => window.confirm('Remove this from My mistakes? It comes back if you get it wrong again.') && void removeMistakeItem(item.id)}
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

export function Mistakes() {
  const settings = useSettings();
  const now = useNow();
  const data = useLiveQuery(async () => {
    const [items, notes] = await Promise.all([listMistakeItems(), listNotes()]);
    return { items, notes };
  }, []);
  const [run, setRun] = useState<MistakeItem[] | null>(null);
  const [result, setResult] = useState<RoundSummary | null>(null);
  const reasons = useMemo(() => (data ? buildReasonContext(data.notes) : null), [data]);
  const noteMap = useMemo(() => new Map((data?.notes ?? []).map((n) => [n.id, n])), [data]);

  if (!data) return <p className="muted">Loading…</p>;
  const active = data.items.filter(isActive).sort((a, b) => b.timesWrong - a.timesWrong || a.lastWrongAt - b.lastWrongAt);
  const retired = data.items.filter((i) => i.retiredAt != null).sort((a, b) => b.retiredAt! - a.retiredAt!);
  const due = dueItems(data.items, now, settings.dayStartHour, Infinity);

  if (run)
    return (
      <section className="session">
        <h1 className="sr-only">My mistakes</h1>
        <header className="session-head">
          <button type="button" className="btn btn-small" onClick={() => setRun(null)} aria-label="End session">
            ✕
          </button>
          <div className="session-progress">My mistakes</div>
          <span />
        </header>
        <MistakeRound
          items={run}
          notes={noteMap}
          reasons={reasons}
          rate={settings.ttsRate}
          slowRate={settings.ttsSlowRate}
          onDone={(summary) => {
            setResult(summary);
            setRun(null);
          }}
        />
      </section>
    );

  return (
    <section>
      <header className="page-head">
        <Link to="/" className="back-link">
          ← Home
        </Link>
        <h1>My mistakes</h1>
        <p className="muted">
          Everything you typed wrong, kept here until you type it right on 3 different days. A wrong answer sends it back to 0.
        </p>
      </header>

      {result && (
        <p className="notice" role="status">
          {result.right} right, {result.wrong} to see again.
        </p>
      )}

      <div className="stat-row">
        <div className="stat">
          <span className="stat-num">{active.length}</span>
          <span className="stat-label">To fix</span>
        </div>
        <div className="stat">
          <span className="stat-num">{due.length}</span>
          <span className="stat-label">Left today</span>
        </div>
        <div className="stat">
          <span className="stat-num">{retired.length}</span>
          <span className="stat-label">Fixed</span>
        </div>
      </div>

      <button type="button" className="btn btn-primary btn-big" disabled={due.length === 0} onClick={() => setRun(due)}>
        {due.length ? `Fix them now (${due.length})` : active.length ? 'All done for today' : 'Nothing to fix'}
      </button>
      {due.length === 0 && active.length > 0 && (
        <button type="button" className="btn btn-big" onClick={() => setRun(active)}>
          Practise them again anyway
        </button>
      )}

      <h2>To fix ({active.length})</h2>
      {active.length === 0 ? <p className="muted">Nothing here. Bra jobbat!</p> : <ul className="list">{active.map((i) => <Item key={i.id} item={i} />)}</ul>}

      {retired.length > 0 && (
        <details className="card help">
          <summary>Fixed ({retired.length})</summary>
          <ul className="list">
            {retired.map((i) => (
              <Item key={i.id} item={i} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
