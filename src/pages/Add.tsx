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
  lessonTitle,
  loadStarterLessons,
  type ImportResult,
  type PlanGroup,
  type StarterResult,
} from '../lib/importer';
import { parseLessonDoc } from '../lib/lessonDoc';
import { buildLessonImport, isFixOnly, lessonTags, looksLikePrintable, mistakesFromFixes, needsToGroup, type ImportText, type LessonImport, type NeedsAnswer } from '../lib/lessonImport';
import { saveFixMistakes, saveLessonExtras } from '../lib/lessonSave';
import { hasSections, parseLesson } from '../lib/parser';
import { weekForLesson } from '../lib/plan';

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

interface Saved extends ImportResult {
  /** What was saved besides cards. */
  extras: string[];
}

function ResultCard({ result, onAgain }: { result: Saved; onAgain: () => void }) {
  return (
    <div className="card" role="status">
      <h2>Saved</h2>
      <p>
        {result.added} added, {result.merged} merged, {result.skipped} skipped.
      </p>
      {result.extras.length > 0 && <p>Also saved: {result.extras.join(', ')}.</p>}
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
  const [result, setResult] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textFileRef = useRef<HTMLInputElement>(null);
  // What the preview found: which kind of text it was, and for a printable, everything besides the cards.
  const [source, setSource] = useState<'block' | 'fix-only' | 'printable' | 'lines'>('lines');
  const [skipped, setSkipped] = useState<{ line: number; raw: string }[]>([]);
  const [lesson, setLesson] = useState<LessonImport | null>(null);
  const [texts, setTexts] = useState<ImportText[]>([]);
  const [needs, setNeeds] = useState<NeedsAnswer[]>([]);
  const [askNumber, setAskNumber] = useState('');
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

  /**
   * The flashcard block comes first: text with "###" sections goes through the
   * card parser. Without sections, a lesson printable is read by its own parser.
   * Anything else is plain card lines, as before. Nothing is saved until Save.
   */
  const preview = async (numberOverride?: number) => {
    const text = draft.text.replace(/\f/g, '\n');
    setLesson(null);
    setTexts([]);
    setNeeds([]);
    if (hasSections(text) || !looksLikePrintable(text)) {
      const parsed = parseLesson(text);
      const number = numberOverride ?? lessonNumber ?? parsed.lessonNumber ?? null;
      const name = draft.name.trim() || parsed.lessonName || '';
      if (number !== lessonNumber || name !== draft.name) setDraft({ ...draft, number: number == null ? '' : String(number), name });
      setSource(isFixOnly(parsed) ? 'fix-only' : hasSections(text) ? 'block' : 'lines');
      setSkipped(parsed.skipped ?? []);
      setProblems(parsed.errors.map((e) => ({ line: e.line, raw: e.raw, error: e.error ?? '' })));
      setPlan(await buildPlan(groupLesson(parsed, number, name)));
      return;
    }
    const doc = parseLessonDoc(text);
    const number = numberOverride ?? lessonNumber ?? doc.number;
    const name = draft.name.trim() || doc.title;
    if (number !== lessonNumber || name !== draft.name) setDraft({ ...draft, number: number == null ? '' : String(number), name });
    const imp = buildLessonImport(doc, number, name);
    setSource('printable');
    setLesson(imp);
    setTexts(imp.texts);
    setNeeds(imp.needs);
    setSkipped(imp.skipped.map((x) => ({ line: x.line, raw: x.raw })));
    setProblems(imp.unparsed.map((u) => ({ line: u.line, raw: u.raw, error: u.reason })));
    setPlan(await buildPlan(imp.groups));
  };

  const importCsv = async (file: File) => {
    const { groups, errors } = csvToGroups(await file.text(), lessonTitle(lessonNumber, draft.name || file.name.replace(/\.\w+$/, '')));
    setProblems(errors);
    setSource('lines');
    setSkipped([]);
    setLesson(null);
    setPlan(await buildPlan(groups));
  };

  const save = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const name = draft.name.trim();
      // Every card is tagged lesson-NN and week-NN (the week comes from the plan's Week Map).
      const opts = { lessonNumber, lessonName: name, extraTags: lessonTags(lessonNumber), cardTypes };
      const r = await applyPlan(plan, opts);
      const extras: string[] = [];
      // Worksheet items I answered in the preview become cards too.
      const filled = needsToGroup(needs, lessonNumber, name);
      if (filled.length) {
        const more = await applyPlan(await buildPlan(filled), opts);
        r.added += more.added;
        r.merged += more.merged;
        r.skipped += more.skipped;
        for (const [deck, n] of Object.entries(more.perDeck)) r.perDeck[deck] = (r.perDeck[deck] ?? 0) + n;
      }
      if (lesson) {
        const x = await saveLessonExtras({ ...lesson, number: lessonNumber, title: name }, texts);
        if (x.texts) extras.push(`${x.texts} text${x.texts === 1 ? '' : 's'} for the Reader, Story mode and Dialogue`);
        if (x.lesson) extras.push('the lesson’s checklist, speaking prompt and questions');
        if (x.report) extras.push('the report, as a Grammar notes page');
      }
      if (source === 'fix-only') {
        const n = await saveFixMistakes(mistakesFromFixes(plan));
        extras.push(`${n} new item${n === 1 ? '' : 's'} in My mistakes`);
      }
      setResult({ ...r, extras });
      setPlan(null);
      setLesson(null);
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
        <p className="notice" role="status">
          {source === 'printable'
            ? 'Read as a lesson printable (no ### sections found).'
            : source === 'fix-only'
              ? `Read as a “Fix the error” block from a marked worksheet. The cards go into the mistakes deck and each line is added to My mistakes.`
              : source === 'block'
                ? 'Read as a flashcard block.'
                : 'Read as card lines.'}{' '}
          {lessonNumber != null ? `Lesson ${lessonNumber}, plan week ${weekForLesson(lessonNumber)}: cards are tagged ${lessonTags(lessonNumber).join(' and ')}.` : ''}
        </p>
        {lessonNumber == null && source !== 'lines' && (
          <form
            className="card card-warn"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.round(Number(askNumber));
              if (askNumber.trim() && n >= 0) void preview(n);
            }}
          >
            <label className="field">
              <span className="field-label">Which lesson is this? No “Lesson N” line was found.</span>
              <input type="number" inputMode="numeric" min={0} value={askNumber} onChange={(e) => setAskNumber(e.target.value)} />
            </label>
            <button type="submit" className="btn" disabled={!askNumber.trim()}>
              Set the lesson number
            </button>
          </form>
        )}
        {plan.length === 0 && <p className="muted">No cards found in this text.</p>}
        <ImportPreview plan={plan} onChange={setPlan} />
        {texts.length > 0 && (
          <section className="card" aria-label="Texts">
            <h3>Texts ({texts.length})</h3>
            <p className="muted small">
              Saved as reading texts for the Reader, Story mode and Dialogue role-play. Lines are <code>Swedish | English</code> or{' '}
              <code>Speaker | Swedish | English</code>. A question line is <code>? question | answer // other answer | line number</code>: fill in the
              answers, or delete the lines you do not want.
            </p>
            {texts.map((t, i) => (
              <label key={i} className="field">
                <span className="field-label">
                  {t.kind}: {t.title}
                </span>
                <textarea className="paste-box" rows={Math.min(12, t.body.split('\n').length + 1)} lang="sv" spellCheck={false} value={t.body} onChange={(e) => setTexts(texts.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
              </label>
            ))}
          </section>
        )}
        {needs.length > 0 && (
          <section className="card" aria-label="Worksheet items that need an answer">
            <h3>Needs an answer ({needs.length})</h3>
            <p className="muted small">Worksheet items with no answer in the file. Type the right answer to save one as a card; leave it empty to leave it out.</p>
            {needs.map((n, i) => (
              <label key={n.key} className="field">
                <span className="field-label" lang="sv">
                  {n.kind === 'fix' ? 'Fix' : 'Translate'} ({n.label}): {n.text}
                </span>
                <input type="text" lang="sv" autoCapitalize="none" spellCheck={false} value={n.answer} onChange={(e) => setNeeds(needs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
              </label>
            ))}
          </section>
        )}
        {lesson?.lesson && (
          <section className="card" aria-label="Lesson details">
            <h3>Also saved with the lesson</h3>
            <ul>
              <li>{lesson.lesson.checklist.length} checklist items</li>
              <li>{lesson.lesson.speakingPrompt ? 'The speaking prompt for Claude' : 'No speaking prompt found'}</li>
              <li>{lesson.lesson.questions.length} conversation questions for the journal</li>
              <li>{lesson.reportPage ? `The report, as the Grammar notes page “${lesson.reportPage.title}”` : 'No report section found'}</li>
            </ul>
            {lesson.notImported.length > 0 && <p className="muted small">{lesson.notImported.length} other worksheet items (fill-ins, sorting, writing) are not imported.</p>}
          </section>
        )}
        {skipped.length > 0 && (
          <details className="card help">
            <summary>
              {skipped.length} line{skipped.length === 1 ? '' : 's'} skipped (not card lines)
            </summary>
            <ul>
              {skipped.map((p) => (
                <li key={p.line}>
                  Line {p.line}: <code>{p.raw}</code>
                </li>
              ))}
            </ul>
          </details>
        )}
        {plan.some((g) => g.rows.some((r) => r.draft.kind === 'vocab')) && (
          <div className="card">
            <CardTypePicker value={cardTypes} onChange={setTypes} />
          </div>
        )}
        <div className="actions sticky-actions">
          <button type="button" className="btn btn-primary" disabled={busy || (total === 0 && !lesson && !needs.some((n) => n.answer.trim()))} onClick={() => void save()}>
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
        Paste the flashcard block from your lesson, a “Fix the error” block from a marked worksheet, or the text of the lesson printable. Words go into “
        {lessonTitle(lessonNumber, draft.name)}”{lessonNumber != null ? `, tagged ${lessonTags(lessonNumber).join(' and ')}` : ''}. The lesson number is read
        from a “Lesson N” line when there is one.
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
        <button type="button" className="btn" onClick={() => textFileRef.current?.click()}>
          Upload a .txt or .md file
        </button>
        <input
          ref={textFileRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          hidden
          aria-label="Upload a lesson file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            // The file only fills the box. Nothing is saved before the preview.
            if (f) void f.text().then((text) => setDraft((d) => ({ ...d, text })));
            e.target.value = '';
          }}
        />
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
