import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { SwedishKeys } from '../components/SwedishKeys';
import { deleteJournal, listDecks, listJournal, listLessons, removeMedia, saveJournal } from '../db/repo';
import type { ID } from '../db/types';
import { useActivity } from '../lib/activity';
import { currentLesson } from '../lib/plan';
import { allPrompts, journalForTutor, pickPrompt } from '../lib/prompts';
import { SpeakButton } from '../study/CardView';
import { SavedRecorder } from './shared';
import { useSettings } from '../lib/hooks';
import { applyPlan, buildPlan, groupLesson, MISTAKES_DECK } from '../lib/importer';
import { parseLesson } from '../lib/parser';
import { dateKey, journalForClaude } from '../lib/practice';

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
  const plan = useLiveQuery(async () => ({ lessons: await listLessons(), decks: await listDecks() }), []);
  const [audioIds, setAudioIds] = useState<ID[]>([]);
  const [tutor, setTutor] = useState<string | null>(null);
  useActivity('reading-writing');
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
    setAudioIds(e?.audioIds ?? []);
    setTutor(null);
    setLoaded(date);
    setStatus(null);
    setPrompt(null);
  }, [entries, date, loaded]);

  if (!entries || !plan) return <p className="muted">Loading…</p>;
  const saved = entries.find((x) => x.date === date);
  const dirty = text !== (saved?.text ?? '');
  // The question an entry was written to stays with it; a new day gets the day's pick.
  const lessonNow = currentLesson(plan.decks, settings);
  const picked = saved?.prompt ? { sv: saved.prompt, en: saved.promptEn ?? '', lesson: saved.lessonNumber ?? null } : pickPrompt(date, allPrompts(plan.lessons), lessonNow, entries);
  const asked = { prompt: picked?.sv ?? '', promptEn: picked?.en ?? '', lessonNumber: picked?.lesson ?? null };
  const save = async () => {
    if (text.trim() || saved) await saveJournal(date, { text, ...asked });
  };
  const keepRecordings = async (ids: ID[]) => {
    setAudioIds(ids);
    await saveJournal(date, { text, ...asked, audioIds: ids });
  };
  const copyForTutor = async () => {
    await save();
    const t = journalForTutor({ date, lessonNumber: asked.lessonNumber, prompt: asked.prompt, promptEn: asked.promptEn, text, hasRecording: audioIds.length > 0 });
    setTutor(t);
    try {
      await navigator.clipboard.writeText(t);
      setStatus('Copied for your tutor.');
    } catch {
      setStatus('Could not copy automatically. Select the text below and copy it.');
    }
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
        {picked && (
          <div className="journal-question">
            <p className="face-type">{date === today ? 'Today’s question' : 'The question'}{picked.lesson != null ? ` · Lesson ${picked.lesson}` : ''}</p>
            <p className="face-question" lang="sv">
              {picked.sv} <SpeakButton text={picked.sv} rate={settings.ttsRate} slowRate={settings.ttsSlowRate} label="Hear the question" />
            </p>
            {picked.en && <p className="muted small">{picked.en}</p>}
          </div>
        )}
        <p className="muted small">Answer by typing, by recording yourself, or both.</p>
        <SavedRecorder ids={audioIds} onChange={(ids) => void keepRecordings(ids)} what="answer" />
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
          <button type="button" className="btn" disabled={!text.trim() && audioIds.length === 0} onClick={() => void copyForTutor()}>
            Copy for my tutor
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
        {tutor && <textarea className="paste-box" rows={6} readOnly value={tutor} aria-label="Text copied for my tutor" onFocus={(e) => e.target.select()} />}

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
              {e.audioIds?.length ? ` · ${e.audioIds.length} recording${e.audioIds.length === 1 ? '' : 's'}` : ''}
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
                    // The entry's recordings go with it.
                    for (const id of e.audioIds ?? []) void removeMedia(id);
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
