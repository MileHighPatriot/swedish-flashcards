import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { SwedishKeys } from '../components/SwedishKeys';
import { deleteJournal, listJournal, saveJournal } from '../db/repo';
import { useSettings } from '../lib/hooks';
import { applyPlan, buildPlan, groupLesson, MISTAKES_DECK } from '../lib/importer';
import { parseLesson } from '../lib/parser';
import { dateKey, journalForClaude } from '../lib/practice';

// Questions from my own lessons, to get a first sentence going.
const STARTERS = ['Vad gjorde du i går?', 'Hur var din dag?', 'Vad gjorde du i helgen?'];

const longDate = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** Keep only the fix lines from Claude's reply; the rest is prose. */
export function fixLines(reply: string) {
  const parsed = parseLesson(reply);
  const sections = parsed.sections
    .map((s) => ({ ...s, items: s.items.filter((i) => i.draft?.kind === 'fix') }))
    .filter((s) => s.items.length > 0);
  return { ...parsed, sections, errors: [], count: sections.reduce((n, s) => n + s.items.length, 0) };
}

export function Journal() {
  const settings = useSettings();
  const entries = useLiveQuery(listJournal, []);
  const today = dateKey();
  const [date, setDate] = useState(today);
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Load the entry for the chosen day once the list is in.
  useEffect(() => {
    if (!entries || loaded === date) return;
    const e = entries.find((x) => x.date === date);
    setText(e?.text ?? '');
    setFeedback(e?.feedback ?? '');
    setLoaded(date);
    setStatus(null);
    setPrompt(null);
  }, [entries, date, loaded]);

  if (!entries) return <p className="muted">Loading…</p>;
  const saved = entries.find((x) => x.date === date);
  const dirty = text !== (saved?.text ?? '');
  const save = async () => {
    if (text.trim() || saved) await saveJournal(date, { text });
  };

  const copy = async () => {
    await save();
    const p = journalForClaude(date, text);
    setPrompt(p);
    try {
      await navigator.clipboard.writeText(p);
      setStatus('Copied. Paste it into your lesson chat, then paste the reply below.');
    } catch {
      setStatus('Could not copy automatically. Select the text below and copy it.');
    }
  };

  const addCards = async () => {
    await saveJournal(date, { text, feedback });
    const fixes = fixLines(feedback);
    if (fixes.count === 0) {
      setStatus('No "fix | wrong | right | why | tags" lines found in that reply.');
      return;
    }
    const plan = await buildPlan(groupLesson(fixes, null, ''));
    const r = await applyPlan(plan, { lessonNumber: null, lessonName: '', extraTags: ['journal'], cardTypes: settings.defaultCardTypes });
    const parts = [`${r.added} new card${r.added === 1 ? '' : 's'} in “${MISTAKES_DECK}”`];
    if (r.merged) parts.push(`${r.merged} already there`);
    if (r.skipped) parts.push(`${r.skipped} skipped as repeats`);
    setStatus(`${parts.join(', ')}.`);
  };

  return (
    <>
      <p className="muted">A few sentences a day in your own words. Claude corrects them, and each mistake comes back as a fix card.</p>
      <div className="card" ref={box}>
        <h2>{date === today ? `Today, ${longDate(date)}` : longDate(date)}</h2>
        {!text.trim() && (
          <p className="muted small" lang="sv">
            {STARTERS[new Date(`${date}T12:00:00`).getDate() % STARTERS.length]}
          </p>
        )}
        <SwedishKeys container={box} />
        <label className="field">
          <span className="field-label">Three to five sentences in Swedish</span>
          <textarea
            rows={6}
            lang="sv"
            autoCapitalize="sentences"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => void save()}
          />
        </label>
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={() => void copy()}>
            Copy for Claude
          </button>
          <button type="button" className="btn" disabled={!dirty} onClick={() => void save()}>
            {dirty ? 'Save' : 'Saved'}
          </button>
          {date !== today && (
            <button type="button" className="btn" onClick={() => setDate(today)}>
              Back to today
            </button>
          )}
        </div>
        {prompt && <textarea className="paste-box" rows={6} readOnly value={prompt} aria-label="Text to paste into Claude" onFocus={(e) => e.target.select()} />}

        <label className="field">
          <span className="field-label">Claude's reply</span>
          <textarea
            className="paste-box"
            rows={5}
            value={feedback}
            placeholder={'Paste the whole reply here. Lines like\nfix | I går jag gick hem. | I går gick jag hem. | Verb in seat 2. | my-mistake, verb-second\nbecome cards.'}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </label>
        <div className="actions">
          <button type="button" className="btn" disabled={!feedback.trim()} onClick={() => void addCards()}>
            Add the corrections as cards
          </button>
        </div>
        {status && (
          <p className="small" role="status">
            {status}
          </p>
        )}
      </div>

      <h2>{entries.length === 0 ? 'No entries yet' : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}</h2>
      <ul className="list">
        {entries.map((e) => (
          <li key={e.id} className="list-item word">
            <div className="word-forms">
              {longDate(e.date)}
              {e.feedback.trim() ? ' · corrected' : ''}
            </div>
            <div className="word-example" lang="sv">
              {e.text.length > 160 ? `${e.text.slice(0, 160)}…` : e.text}
            </div>
            <div className="word-foot">
              <span />
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    setDate(e.date);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    if (!window.confirm(`Delete the entry for ${longDate(e.date)}?`)) return;
                    void deleteJournal(e.date).then(() => {
                      if (e.date === date) setLoaded(null);
                    });
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
