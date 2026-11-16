import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { listCards, listReviews } from '../db/repo';
import { useNow, useSettings } from '../lib/hooks';
import { DAY_MS, studyDayKey } from '../lib/scheduler';
import { DAYS_PER_FREEZE, MAX_FREEZES, computeStreak, dateOfKey, dayCounts, forecast, heatmap, maturityCounts, retention } from '../lib/stats';

const fmtDay = (key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  dateOfKey(key).toLocaleDateString(undefined, opts);
const pct = (r: number | null) => (r == null ? '–' : `${Math.round(r * 100)}%`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const MATURITY = [
  { key: 'new', label: 'New', hint: 'never studied' },
  { key: 'learning', label: 'Learning', hint: 'in the first steps' },
  { key: 'young', label: 'Young', hint: 'interval under 21 days' },
  { key: 'mature', label: 'Mature', hint: 'interval of 21 days or more' },
] as const;

const WEEKS = 18;
const FORECAST_DAYS = 14;

export function Stats() {
  const settings = useSettings();
  const now = useNow();
  const today = studyDayKey(now, settings.dayStartHour);
  const data = useLiveQuery(async () => ({ reviews: await listReviews(0), cards: await listCards() }), []);
  const [heatFocus, setHeatFocus] = useState<string | null>(null);
  const [barFocus, setBarFocus] = useState<number | null>(null);

  const s = useMemo(() => {
    if (!data) return null;
    const counts = dayCounts(data.reviews, settings.dayStartHour);
    const active = new Set(counts.keys());
    return {
      counts,
      streak: computeStreak(active, today),
      grid: heatmap(counts, today, WEEKS, settings.dailyGoal),
      month: retention(data.reviews, now - 30 * DAY_MS),
      all: retention(data.reviews),
      maturity: maturityCounts(data.cards),
      forecast: forecast(data.cards, now, settings.dayStartHour, FORECAST_DAYS),
      total: data.reviews.length,
      daysStudied: active.size,
    };
    // `now` only matters through `today` for these numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, today, settings.dayStartHour, settings.dailyGoal]);

  if (!s) return <p className="muted">Loading…</p>;

  const doneToday = s.counts.get(today)?.real ?? 0;
  const goalPct = Math.min(100, Math.round((doneToday / Math.max(1, settings.dailyGoal)) * 100));
  const inRotation = MATURITY.reduce((n, m) => n + s.maturity[m.key], 0);
  const maxDue = Math.max(1, ...s.forecast.map((d) => d.count));
  const peak = s.forecast.reduce((best, d, i) => (d.count > s.forecast[best].count ? i : best), 0);
  const heatCell = heatFocus ? s.grid.flat().find((c) => c.key === heatFocus) : null;
  const last30 = Array.from({ length: 30 }, (_, i) => studyDayKey(now - i * DAY_MS, settings.dayStartHour));
  const activeLast30 = last30.filter((k) => s.counts.has(k)).length;

  return (
    <section className="viz-root">
      <header className="page-head">
        <h1>Stats</h1>
      </header>

      {/* ----- streak ----- */}
      <div className="card streak-card">
        <div className="streak-main">
          <span className="streak-num">{s.streak.current}</span>
          <span>
            <strong>day streak</strong>
            <br />
            <span className="muted small">
              {s.streak.activeToday ? 'Studied today.' : s.streak.current > 0 ? 'Study today to keep it going.' : 'Study today to start one.'}
            </span>
          </span>
        </div>
        <dl className="mini-stats">
          <div>
            <dt>Best</dt>
            <dd>{plural(s.streak.best, 'day')}</dd>
          </div>
          <div>
            <dt>Freezes</dt>
            <dd>
              {s.streak.freezes} of {MAX_FREEZES}
            </dd>
          </div>
          <div>
            <dt>Today</dt>
            <dd>
              {Math.min(doneToday, settings.dailyGoal)} / {settings.dailyGoal}
            </dd>
          </div>
        </dl>
        <div className="progress" role="progressbar" aria-label="Daily goal" aria-valuemin={0} aria-valuemax={settings.dailyGoal} aria-valuenow={Math.min(doneToday, settings.dailyGoal)}>
          <div className="progress-bar" style={{ width: `${goalPct}%` }} />
        </div>
        <p className="muted small">
          Miss a day and a freeze covers it, so the streak carries on. You earn a freeze for every {DAYS_PER_FREEZE} days you study.
          {s.streak.frozenDays.length > 0 && ` Freezes used in this streak: ${s.streak.frozenDays.map((k) => fmtDay(k, { day: 'numeric', month: 'short' })).join(', ')}.`}
        </p>
      </div>

      {/* ----- heatmap ----- */}
      <div className="card">
        <h2>Review history</h2>
        <p className="muted small">
          You studied on {activeLast30} of the last 30 days. {plural(s.total, 'review')} in all, over {plural(s.daysStudied, 'day')}.
        </p>
        <div className="heat" role="img" aria-label={`Reviews per day for the last ${WEEKS} weeks. Studied on ${activeLast30} of the last 30 days.`}>
          <div className="heat-days" aria-hidden="true">
            <span>Mon</span>
            <span>Wed</span>
            <span>Fri</span>
            <span>Sun</span>
          </div>
          <div className="heat-grid" onPointerLeave={() => setHeatFocus(null)}>
            {s.grid.map((week) => (
              <div key={week[0].key} className="heat-week">
                {week.map((c) => (
                  <span
                    key={c.key}
                    className={`heat-cell heat-${c.level} ${c.future ? 'heat-future' : ''} ${c.key === today ? 'heat-today' : ''} ${c.key === heatFocus ? 'is-focus' : ''}`}
                    title={c.future ? undefined : `${fmtDay(c.key)}: ${plural(c.count, 'review')}`}
                    onPointerEnter={() => !c.future && setHeatFocus(c.key)}
                    onClick={() => !c.future && setHeatFocus(c.key)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="heat-foot">
          <span className="small" role="status">
            {heatCell ? `${fmtDay(heatCell.key)}: ${plural(heatCell.count, 'review')}` : 'Tap a day to see its count.'}
          </span>
          <span className="heat-legend small muted" aria-hidden="true">
            Less
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={`heat-cell heat-${l}`} />
            ))}
            Goal
          </span>
        </div>
        <details className="table-view">
          <summary>Show the last 14 days as a table</summary>
          <table className="md-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Reviews</th>
                <th scope="col">Of which cram</th>
              </tr>
            </thead>
            <tbody>
              {last30.slice(0, 14).map((k) => {
                const c = s.counts.get(k) ?? { all: 0, real: 0 };
                return (
                  <tr key={k}>
                    <td>{fmtDay(k)}</td>
                    <td>{c.all}</td>
                    <td>{c.all - c.real}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      </div>

      {/* ----- retention ----- */}
      <div className="card">
        <h2>Retention</h2>
        <div className="stat-row">
          <div className="stat stat-flat">
            <span className="stat-num">{pct(s.month.rate)}</span>
            <span className="stat-label">Last 30 days</span>
          </div>
          <div className="stat stat-flat">
            <span className="stat-num">{pct(s.all.rate)}</span>
            <span className="stat-label">All time</span>
          </div>
          <div className="stat stat-flat">
            <span className="stat-num">{Math.round(settings.targetRetention * 100)}%</span>
            <span className="stat-label">Your target</span>
          </div>
        </div>
        <p className="muted small">
          {s.all.total === 0
            ? 'This fills in once cards start coming back for review, a few days after you first learn them.'
            : `How often you remembered a card that was due: ${s.month.passed} of ${s.month.total} in the last 30 days. Close to your target means the schedule fits you.`}
        </p>
      </div>

      {/* ----- maturity ----- */}
      <div className="card">
        <h2>Cards by maturity</h2>
        {inRotation > 0 && (
          <div className="stack" role="img" aria-label={MATURITY.map((m) => `${m.label}: ${s.maturity[m.key]}`).join(', ')}>
            {MATURITY.filter((m) => s.maturity[m.key] > 0).map((m) => (
              <span key={m.key} className={`stack-seg series-${m.key}`} style={{ flexGrow: s.maturity[m.key] }} title={`${m.label}: ${s.maturity[m.key]}`} />
            ))}
          </div>
        )}
        <ul className="legend">
          {MATURITY.map((m) => (
            <li key={m.key}>
              <span className={`swatch series-${m.key}`} aria-hidden="true" />
              <span className="legend-label">
                {m.label} <span className="muted small">{m.hint}</span>
              </span>
              <strong>{s.maturity[m.key]}</strong>
            </li>
          ))}
          {s.maturity.suspended > 0 && (
            <li>
              <span className="swatch swatch-off" aria-hidden="true" />
              <span className="legend-label">
                Suspended <span className="muted small">locked or set aside</span>
              </span>
              <strong>{s.maturity.suspended}</strong>
            </li>
          )}
        </ul>
      </div>

      {/* ----- forecast ----- */}
      <div className="card">
        <h2>Reviews coming up</h2>
        <p className="muted small">Cards already scheduled for the next {FORECAST_DAYS} days. New cards you learn will add to this.</p>
        <div className="bars" role="img" aria-label={`Reviews due per day for the next ${FORECAST_DAYS} days. Today: ${s.forecast[0].count}. Busiest day: ${fmtDay(s.forecast[peak].key)} with ${s.forecast[peak].count}.`} onPointerLeave={() => setBarFocus(null)}>
          {s.forecast.map((d, i) => (
            <div key={d.key} className={`bar-col ${barFocus === i ? 'is-focus' : ''}`} onPointerEnter={() => setBarFocus(i)} onClick={() => setBarFocus(i)} title={`${fmtDay(d.key)}: ${d.count} due`}>
              <span className="bar-value">{(i === 0 || i === peak || barFocus === i) && d.count > 0 ? d.count : ''}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ height: `${(d.count / maxDue) * 100}%` }} />
              </span>
              <span className="bar-label">{i === 0 ? 'Today' : i % 2 === 0 ? fmtDay(d.key, { day: 'numeric' }) : ''}</span>
            </div>
          ))}
        </div>
        <p className="small" role="status">
          {barFocus != null ? `${fmtDay(s.forecast[barFocus].key)}: ${s.forecast[barFocus].count} due` : `Next ${FORECAST_DAYS} days: ${s.forecast.reduce((n, d) => n + d.count, 0)} reviews.`}
        </p>
        <details className="table-view">
          <summary>Show as a table</summary>
          <table className="md-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {s.forecast.map((d, i) => (
                <tr key={d.key}>
                  <td>{i === 0 ? 'Today (with overdue)' : fmtDay(d.key)}</td>
                  <td>{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>

      <p className="muted small">
        Looking for what to fix? Your <Link to="/grammar?tab=weak">weak spots</Link> and <Link to="/grammar?tab=mistakes">mistake log</Link> are under Grammar.
      </p>
    </section>
  );
}
