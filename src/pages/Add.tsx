import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { ImportPreview } from '../components/ImportPreview';
import { SwedishKeys } from '../components/SwedishKeys';
import { CardTypePicker } from '../components/NoteEditor';
import { NoteForm } from '../components/NoteForm';
import { listDecks, listNotes } from '../db/repo';
import type { VocabCardType } from '../db/types';
import { csvToGroups, dateStamp, downloadBackup, downloadFile, notesToCSV, restoreBackup } from '../lib/backup';
import { useSettings } from '../lib/hooks';
import {
  applyPlan,
  buildPlan,
  groupLesson,
  lessonTag,
  lessonTitle,
  loadStarterLessons,
  type ImportResult,
  type PlanGroup,
  type StarterResult,
} from '../lib/importer';
import { parseLesson } from '../lib/parser';

type Tab = 'paste' | 'card' | 'files';
const TABS: { id: Tab; label: string }[] = [
  { id: 'paste', label: 'Paste' },
  { id: 'card', label: 'One card' },
  { id: 'files', label: 'Files' },
];

const DRAFT_KEY = 'svenska-kort:paste-draft';
interface PasteDraft {
  text: string;
  number: string;
  name: string;
}
function loadDraft(): PasteDraft {
  try {
    return { text: '', number: '', name: '', ...(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<PasteDraft>) };
  } catch {
    return { text: '', number: '', name: '' };
  }
}

const EXAMPLE = `### Vocab
hund | dog | en hund, hundar | Hunden springer i parken. = The dog runs in the park. | animals
äta | eat | äter, åt, ätit | Vi äter middag. = We eat dinner. | verbs, food

### Phrases
Vad bra! | How nice! | | | conversation

### Grammar rules
rule | Where does the verb go after a time word? | Seat 2: I går arbetade jag. | Verb second. | verb-second

### Fix the error
fix | I går jag arbetade. | I går arbetade jag. | Verb in seat 2. | verb-second

### Reorder
reorder | arbetade / jag / i går | I går arbetade jag. // Jag arbetade i går. | Verb second. | word-order

### Translate
translate | Did you read the book? | Läste du boken? | Verb first. | questions`;

interface Problem {
  line: number;
  raw: string;
  error: string;
}

function ResultCard({ result, onAgain }: { result: ImportResult; onAgain: () => void }) {
  return (
    <div className="card" role="status">
      <h2>Saved</h2>
      <p>
        {result.added} added, {result.merged} merged, {result.skipped} skipped.
      </p>
      <ul>
        {Object.entries(result.perDeck).map(([deck, n]) => (
          <li key={deck}>
            {deck}: {n}
          </li>
        ))}
      </ul>
      <div className="actions">
        <Link className="btn btn-primary" to="/">
          Go to home
        </Link>
        <button type="button" className="btn" onClick={onAgain}>
          Add another lesson
        </button>
      </div>
    </div>
  );
}

function PasteLesson() {
  const settings = useSettings();
  const [draft, setDraft] = useState<PasteDraft>(loadDraft);
  const [plan, setPlan] = useState<PlanGroup[] | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [types, setTypes] = useState<VocabCardType[] | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLDivElement>(null);

  // Autosave what is typed, so a refresh or a crash never loses a pasted lesson.
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage full or blocked: the text is still on screen */
    }
  }, [draft]);

  const lessonNumber = draft.number.trim() === '' || Number.isNaN(Number(draft.number)) ? null : Math.max(0, Math.round(Number(draft.number)));
  const cardTypes = types ?? settings.defaultCardTypes;

  const preview = async () => {
    const parsed = parseLesson(draft.text);
    setProblems(parsed.errors.map((e) => ({ line: e.line, raw: e.raw, error: e.error ?? '' })));
    setPlan(await buildPlan(groupLesson(parsed, lessonNumber, draft.name)));
  };

  const importCsv = async (file: File) => {
    const { groups, errors } = csvToGroups(await file.text(), lessonTitle(lessonNumber, draft.name || file.name.replace(/\.\w+$/, '')));
    setProblems(errors);
    setPlan(await buildPlan(groups));
  };

  const save = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const tag = lessonTag(lessonNumber);
      const r = await applyPlan(plan, { lessonNumber, lessonName: draft.name.trim(), extraTags: tag ? [tag] : [], cardTypes });
      setResult(r);
      setPlan(null);
      setDraft({ text: '', number: '', name: '' });
    } finally {
      setBusy(false);
    }
  };

  if (result) return <ResultCard result={result} onAgain={() => setResult(null)} />;

  if (plan) {
    const total = plan.reduce((n, g) => n + g.rows.filter((r) => r.action !== 'skip').length, 0);
    return (
      <>
        <h2>Check before saving</h2>
        {problems.length > 0 && (
          <div className="card card-warn" role="alert">
            <strong>
              {problems.length} line{problems.length === 1 ? '' : 's'} could not be read and will be left out:
            </strong>
            <ul>
              {problems.map((p) => (
                <li key={p.line}>
                  Line {p.line}: <code>{p.raw}</code> <span className="muted">({p.error})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {plan.length === 0 && <p className="muted">Nothing to import yet.</p>}
        <ImportPreview plan={plan} onChange={setPlan} />
        {plan.some((g) => g.rows.some((r) => r.draft.kind === 'vocab')) && (
          <div className="card">
            <CardTypePicker value={cardTypes} onChange={setTypes} />
          </div>
        )}
        <div className="actions sticky-actions">
          <button type="button" className="btn btn-primary" disabled={busy || total === 0} onClick={() => void save()}>
            Save {total} card{total === 1 ? '' : 's'}
          </button>
          <button type="button" className="btn" onClick={() => setPlan(null)}>
            Back to the text
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="field-grid">
        <label className="field">
          <span className="field-label">Lesson number</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.number}
            placeholder="7"
            onChange={(e) => setDraft({ ...draft, number: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">Lesson name</span>
          <input type="text" value={draft.name} placeholder="Family" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
      </div>
      <p className="muted small">
        Words go into “{lessonTitle(lessonNumber, draft.name)}”{lessonTag(lessonNumber) ? `, tagged ${lessonTag(lessonNumber)}` : ''}. Grammar and
        phrases get their own decks. You can change all of that on the next screen.
      </p>
      <div ref={pasteRef}>
      <SwedishKeys container={pasteRef} />
      <label className="field">
        <span className="field-label">Paste the lesson here</span>
        <textarea
          className="paste-box"
          rows={12}
          value={draft.text}
          lang="sv"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={'hund | dog | en hund, hundar | Hunden springer i parken. = The dog runs in the park.'}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
      </label>
      </div>
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={!draft.text.trim()} onClick={() => void preview()}>
          Preview
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Import a CSV file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importCsv(f);
            e.target.value = '';
          }}
        />
        <button type="button" className="btn" onClick={() => setDraft({ ...draft, text: EXAMPLE })}>
          Show me an example
        </button>
      </div>

      <details className="card help">
        <summary>What can I paste?</summary>
        <p>One card per line. Pipes are best, but tabs, dashes and commas work too.</p>
        <p>
          <strong>Words and phrases</strong>
        </p>
        <pre>Swedish | English | forms | example = translation | tags</pre>
        <ul>
          <li>
            Nouns: <code>en hund, hundar</code> or <code>en hund, hunden, hundar</code>
          </li>
          <li>
            Verbs: <code>äter, åt</code> or <code>äter, åt, ätit</code>
          </li>
          <li>
            Adjectives: <code>stor, stort, stora</code>
          </li>
          <li>Everything after the English is optional. Leave a field empty to skip it.</li>
        </ul>
        <p>
          <strong>Grammar</strong>
        </p>
        <pre>type | prompt | answer | explanation | tags</pre>
        <p>
          Type is <code>rule</code>, <code>fix</code>, <code>reorder</code> or <code>translate</code>. Separate other correct answers with{' '}
          <code>//</code>. Reorder prompts list the words with <code>/</code> between them.
        </p>
        <p>
          <strong>Sections</strong> (optional): <code>### Vocab</code>, <code>### Phrases</code>, <code>### Grammar rules</code>,{' '}
          <code>### Fix the error</code>, <code>### Reorder</code>, <code>### Translate</code>.
        </p>
      </details>
    </>
  );
}

function Files() {
  const decks = useLiveQuery(listDecks, []);
  const [deckId, setDeckId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [starter, setStarter] = useState<StarterResult | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; data: unknown } | null>(null);

  const exportCsv = async () => {
    const all = await listDecks();
    const notes = await listNotes(deckId || undefined);
    const name = deckId ? (all.find((d) => d.id === deckId)?.name ?? 'deck') : 'all-decks';
    // The BOM makes Excel read å, ä, ö correctly.
    downloadFile(`svenska-kort-${name.replace(/[^\p{L}\p{N}]+/gu, '-')}-${dateStamp()}.csv`, '﻿' + notesToCSV(notes, all), 'text/csv');
    setMessage(`Exported ${notes.length} cards.`);
  };

  const pickRestore = async (file: File) => {
    try {
      setPending({ name: file.name, data: JSON.parse(await file.text()) });
      setMessage(null);
    } catch {
      setMessage('That file is not valid JSON.');
    }
  };

  const restore = async (mode: 'merge' | 'replace') => {
    if (!pending) return;
    if (mode === 'replace' && !window.confirm('Replace EVERYTHING in the app with this backup? Your current cards and history will be erased.'))
      return;
    try {
      const r = await restoreBackup(pending.data, mode);
      setMessage(`Restored ${r.decks} decks, ${r.notes} cards and ${r.reviews} reviews from ${pending.name}.`);
      setPending(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not restore that file.');
    }
  };

  return (
    <>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      <div className="card">
        <h2>Full backup</h2>
        <p className="muted">One file with every deck, card, review and setting. Keep a copy somewhere safe.</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => void downloadBackup()}>
            Download backup
          </button>
          <button type="button" className="btn" onClick={() => restoreRef.current?.click()}>
            Restore from a backup…
          </button>
          <input
            ref={restoreRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickRestore(f);
              e.target.value = '';
            }}
          />
        </div>
        {pending && (
          <div className="card card-warn">
            <p>
              <strong>{pending.name}</strong>: how should it be restored?
            </p>
            <div className="actions">
              <button type="button" className="btn" onClick={() => void restore('merge')}>
                Merge with what I have
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void restore('replace')}>
                Replace everything
              </button>
              <button type="button" className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
            <p className="muted small">Merge keeps the newest version of each card. Replace erases the app first.</p>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Spreadsheet (CSV)</h2>
        <label className="field">
          <span className="field-label">Deck to export</span>
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            <option value="">All decks</option>
            {decks?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void exportCsv()}>
            Export CSV
          </button>
          <Link className="btn" to="/add?tab=paste">
            Import a CSV…
          </Link>
        </div>
        <p className="muted small">CSV import is on the Paste lesson tab, so it gets the same preview and duplicate check.</p>
      </div>

      <div className="card">
        <h2>Starter lessons</h2>
        <p className="muted">
          Lessons 1 and 2: grammar rules, your mistakes, time words, conversation phrases and the verb lists. Safe to press again; cards you
          already have are left alone.
        </p>
        <button type="button" className="btn" onClick={() => void loadStarterLessons().then(setStarter)}>
          Load starter lessons
        </button>
        {starter && (
          <div role="status">
            <p>
              {starter.added} added, {starter.skipped} already there.
              {starter.errors.length > 0 && ` ${starter.errors.length} lines could not be read.`}
            </p>
            {starter.errors.length > 0 && (
              <ul>
                {starter.errors.map((e) => (
                  <li key={`${e.line}-${e.raw}`}>
                    <code>{e.raw}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function Add() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'paste') as Tab;
  return (
    <section>
      <header className="page-head">
        <h1>Add</h1>
      </header>
      <div className="tabs" role="tablist" aria-label="Ways to add cards">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="add-panel"
            className={tab === t.id ? 'tab-btn tab-btn-on' : 'tab-btn'}
            onClick={() => setParams({ tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="add-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'paste' && <PasteLesson />}
        {tab === 'card' && <NoteForm />}
        {tab === 'files' && <Files />}
      </div>
    </section>
  );
}
