import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addHours, deleteHours, listHours, listReviews, updateHours, updateSettings } from '../db/repo';
import { HOURS_CATEGORIES, HOURS_LABELS, type HoursCategory, type HoursEntry } from '../db/types';
import { useNow, useSettings } from '../lib/hooks';
import { formatMinutes, hoursSheetLine, mondayOf, quarter, weekSummary } from '../lib/hours';
import { addDays, isoDate, phaseForWeek } from '../lib/plan';

const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const hours = (h: number) => `${Math.round(h * 100) / 100} h`;

/** A bar with its numbers written out next to it, so nothing depends on the colour. */
function Progress({ label, value, max }: { label: string; value: number; max: number }) {
  const shown = Math.round(value * 100) / 100;
  return (
    <div className="hours-progress">
      <div className="hours-progress-text">
        <span>{label}</span>
        <strong>
          {shown} of {max} h{max > 0 ? ` (${Math.round((value / max) * 100)}%)` : ''}
        </strong>
      </div>
      <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(shown, max)} aria-valuetext={`${shown} of ${max} hours`}>
        <div className="progress-bar" style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

function Entry({ entry }: { entry: HoursEntry }) {
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(String(entry.minutes));
  const [category, setCategory] = useState(entry.category);
  const [date, setDate] = useState(entry.date);
  if (editing)
    return (
      <li className="list-item word">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void updateHours(entry.id, { date, category, minutes: Math.max(0, Math.round(Number(minutes) || 0)) }).then(() => setEditing(false));
          }}
        >
          <div className="field-grid">
            <label className="field">
              <span className="field-label">Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as HoursCategory)}>
                {HOURS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {HOURS_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Minutes</span>
              <input type="number" inputMode="numeric" min={0} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </label>
          </div>
          <div className="actions">
            <button type="submit" className="btn btn-primary btn-small">
              Save
            </button>
            <button type="button" className="btn btn-small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  return (
    <li className="list-item word">
      <div className="word-main">
        <span>
          <strong>{HOURS_LABELS[entry.category]}</strong> · {formatMinutes(entry.minutes)}
        </span>
        {entry.auto && <span className="pill pill-tag">auto</span>}
      </div>
      <div className="word-forms">
        {shortDate(entry.date)}
        {entry.note ? ` · ${entry.note}` : ''}
        {entry.auto ? ' · logged by the app on one device' : ''}
      </div>
      {!entry.auto && (
        <div className="actions">
          <button type="button" className="btn btn-small" aria-label={`Edit ${HOURS_LABELS[entry.category]}, ${shortDate(entry.date)}`} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="btn btn-small" aria-label={`Delete ${HOURS_LABELS[entry.category]}, ${shortDate(entry.date)}`} onClick={() => window.confirm('Delete this entry?') && void deleteHours(entry.id)}>
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

/** The hours log for one week, with manual entry. Shown as the middle section of Progress. */
export function HoursPanel() {
  const settings = useSettings();
  const now = useNow();
  const today = isoDate(now);
  const [monday, setMonday] = useState(() => mondayOf(isoDate(Date.now())));
  const data = useLiveQuery(async () => ({ entries: await listHours(), reviews: await listReviews(0) }), []);
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState<HoursCategory>('lessons');
  const [minutes, setMinutes] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  if (!data) return <p className="muted">Loading…</p>;
  const w = weekSummary({ ...data, countAuto: settings.hoursCountAuto }, monday);
  const phase = phaseForWeek(w.week);
  const mine = data.entries.filter((e) => e.date >= monday && e.date < addDays(monday, 7)).sort((a, b) => b.date.localeCompare(a.date));
  const line = hoursSheetLine(w.minutes);

  const add = async () => {
    const m = Math.round(Number(minutes));
    if (!m || m <= 0) return;
    await addHours({ date, category, minutes: m });
    setMinutes('');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(line);
      setCopied('Copied. Paste it into this week’s row of the Hours Log.');
    } catch {
      setCopied(`Could not copy automatically. The line is: ${line.split('\t').join('  |  ')}`);
    }
  };

  return (
    <div>
      <p className="muted">Your Hours Log, by calendar week. Target: 11 hours a week (9 in the two holiday weeks), 634 in all.</p>

      <div className="hours-nav">
        <button type="button" className="btn" onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">
          ← Previous
        </button>
        <div className="hours-week" role="status">
          <strong>{w.week > 0 ? `Plan week ${w.week}` : 'Before the plan'}</strong>
          <span className="muted small">
            {shortDate(w.monday)} to {shortDate(w.sunday)}
            {phase ? ` · Phase ${phase.phase}` : ''}
          </span>
        </div>
        <button type="button" className="btn" onClick={() => setMonday(addDays(monday, 7))} aria-label="Next week">
          Next →
        </button>
      </div>
      {monday !== mondayOf(today) && (
        <button type="button" className="btn btn-small" onClick={() => setMonday(mondayOf(today))}>
          Back to this week
        </button>
      )}

      <div className="card">
        <table className="hours-table">
          <caption className="sr-only">Hours this week by category</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Hours</th>
              <th scope="col">Auto</th>
            </tr>
          </thead>
          <tbody>
            {HOURS_CATEGORIES.map((c) => (
              <tr key={c}>
                <th scope="row">{HOURS_LABELS[c]}</th>
                <td>{hours(w.minutes[c] / 60)}</td>
                <td>{w.autoMinutes[c] > 0 ? formatMinutes(w.autoMinutes[c]) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Progress label="This week" value={w.totalHours} max={w.targetHours} />
        <Progress label="Plan so far, to the end of this week" value={w.cumulativeHours} max={w.cumulativeTarget} />
        <Progress label="Whole plan" value={w.overallHours} max={w.overallTarget} />
        <label className="check">
          <input type="checkbox" checked={settings.hoursCountAuto} onChange={(e) => void updateSettings({ hoursCountAuto: e.target.checked })} />
          Count the practice time the app logged by itself
        </label>
        <p className="muted small">
          Flashcard time comes from your reviews (each review counts for at most 60 seconds). Practice tools and checkpoints log the time you are active in them, labelled
          “auto”. Lessons with Claude, speaking with Claude, reading and writing on paper and your own listening are yours to add below.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void copy()}>
            Copy for my sheet
          </button>
          <span className="small" role="status">
            {copied}
          </span>
        </div>
        <p className="muted small">
          Copies five numbers, rounded to a quarter of an hour, in the order of the Hours Log columns: {HOURS_CATEGORIES.map((c) => `${HOURS_LABELS[c]} ${quarter(w.minutes[c])}`).join(', ')}.
        </p>
      </div>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <h3>Add time</h3>
        <div className="field-grid">
          <label className="field">
            <span className="field-label">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as HoursCategory)}>
              {HOURS_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {HOURS_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Minutes</span>
            <input type="number" inputMode="numeric" min={1} max={1440} value={minutes} placeholder="100" onChange={(e) => setMinutes(e.target.value)} />
          </label>
        </div>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={!(Number(minutes) > 0)}>
            Add
          </button>
          {[
            ['Lesson, 100 min', 'lessons', 100],
            ['Speaking with Claude, 40 min', 'speaking', 40],
            ['Reading, 45 min', 'reading-writing', 45],
            ['Writing, 30 min', 'reading-writing', 30],
          ].map(([label, c, m]) => (
            <button key={label} type="button" className="btn btn-small" onClick={() => void addHours({ date, category: c as HoursCategory, minutes: m as number })}>
              + {label}
            </button>
          ))}
        </div>
      </form>

      <h3>This week’s entries ({mine.length})</h3>
      {mine.length === 0 ? <p className="muted">Nothing logged by hand or by the practice tools this week.</p> : <ul className="list">{mine.map((e) => <Entry key={e.id} entry={e} />)}</ul>}
    </div>
  );
}
