import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Field, TagsInput } from '../components/NoteEditor';
import { SwedishKeys } from '../components/SwedishKeys';
import { DEFAULT_PAGES } from '../data/grammarPages';
import {
  addMistake,
  createGrammarPage,
  deleteGrammarPage,
  getGrammarPage,
  listCards,
  listDecks,
  listGrammarPages,
  listMistakes,
  listNotes,
  listReviews,
  recordTyped,
  removeMistake,
  unlockDeck,
  updateGrammarPage,
} from '../db/repo';
import type { Deck, Note } from '../db/types';
import { useActivity } from '../lib/activity';
import { checkAnswer } from '../lib/check';
import { Markdown } from '../lib/markdown';
import { shuffled } from '../lib/queue';
import { TOPICS, topicFor, topicTitle } from '../lib/topics';
import { VERB_FORM_LABELS, drillVerbs, lessonLabel, pastRule, type DrillVerb, type VerbForm } from '../lib/verbdrill';
import { pickForm, weightedPick } from '../lib/verbtable';
import { VerbTable } from './VerbTable';
import { LearnNav } from './Hubs';
import { computeWeakSpots, exportForClaude, weakSpotCardIds } from '../lib/weakspots';
import { buildReasonContext } from '../lib/reasons';
import { TypedInput, VerdictBox, withReason, type Answer } from '../study/CardView';

// ---------- a notes page ----------

const draftKey = (slug: string) => `svenska-kort:grammar-draft:${slug}`;

export function GrammarPageView({ slug, embedded = false }: { slug: string; embedded?: boolean }) {
  const page = useLiveQuery(async () => (await getGrammarPage(slug)) ?? null, [slug]);
  const practice = useLiveQuery(async () => {
    const [notes, cards] = await Promise.all([listNotes(), listCards()]);
    const ids = new Set(notes.filter((n) => topicFor(n) === slug).map((n) => n.id));
    return cards.filter((c) => !c.suspended && ids.has(c.noteId)).length;
  }, [slug]);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const editor = useRef<HTMLDivElement>(null);
  const original = DEFAULT_PAGES.find((p) => p.slug === slug);

  // Keep an unsaved edit safe across a refresh.
  useEffect(() => {
    if (!editing) return;
    try {
      localStorage.setItem(draftKey(slug), text);
    } catch {
      /* ignore */
    }
  }, [editing, text, slug]);

  if (page === undefined) return <p className="muted">Loading…</p>;
  if (page === null)
    return (
      <div className="card">
        <p>There is no notes page for “{topicTitle(slug) ?? slug}” yet.</p>
        {!embedded && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void createGrammarPage(topicTitle(slug) ?? slug, original?.markdown).then((p) => navigate(`/grammar/${p.slug}`, { replace: true }))}
          >
            Create it
          </button>
        )}
      </div>
    );

  const startEdit = () => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(draftKey(slug));
    } catch {
      /* ignore */
    }
    setTitle(page.title);
    setText(saved && saved !== page.markdown && window.confirm('Pick up your unsaved edit of this page?') ? saved : page.markdown);
    setEditing(true);
  };
  const stopEdit = () => {
    try {
      localStorage.removeItem(draftKey(slug));
    } catch {
      /* ignore */
    }
    setEditing(false);
  };
  const save = async () => {
    await updateGrammarPage(page.id, { title: title.trim() || page.title, markdown: text });
    stopEdit();
  };

  if (editing)
    return (
      <div ref={editor}>
        <Field label="Page title">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <SwedishKeys container={editor} />
        <label className="field">
          <span className="field-label">Notes (markdown)</span>
          <textarea className="paste-box" rows={16} lang="sv" spellCheck={false} autoCapitalize="none" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <details className="card help">
          <summary>Formatting help</summary>
          <pre>{`# Title        ## Section
**bold**  *italic*  ~~wrong~~
- bullet       1. numbered

| Stem ends in | Ending | Example |
|---|---|---|
| p | -te | köp → köpte |

| Seat 1 | Seat 2 (verb) | Seat 3 | Rest |
|---|---|---|---|
| Igår | arbetade | jag | i butiken. |`}</pre>
          <p className="muted small">A cell that is only -te, -de or -ade gets its colour. A table starting with “Seat” becomes the seat diagram.</p>
        </details>
        <div className="actions sticky-actions">
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            Save page
          </button>
          <button type="button" className="btn" onClick={stopEdit}>
            Cancel
          </button>
        </div>
        <h2>Preview</h2>
        <div className="card">
          <Markdown source={text} />
        </div>
      </div>
    );

  return (
    <article>
      <div className={embedded ? '' : 'card'}>
        <Markdown source={page.markdown} />
      </div>
      {!embedded && (
        <div className="actions">
          {!!practice && (
            <Link className="btn btn-primary" to={`/study?topic=${slug}`}>
              Practise this rule ({practice} cards)
            </Link>
          )}
          <button type="button" className="btn" onClick={startEdit}>
            Edit page
          </button>
          {original && original.markdown !== page.markdown && (
            <button
              type="button"
              className="btn"
              onClick={() => window.confirm('Replace your version of this page with the original text?') && void updateGrammarPage(page.id, { title: original.title, markdown: original.markdown })}
            >
              Reset to original
            </button>
          )}
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (!window.confirm(`Delete the page “${page.title}”? This cannot be undone.`)) return;
              void deleteGrammarPage(page.id).then(() => navigate('/grammar'));
            }}
          >
            Delete page
          </button>
        </div>
      )}
    </article>
  );
}

// ---------- notes list ----------

function unlockLabel(deck: Deck, notes: Note[]): string {
  const tag = notes.find((n) => n.deckId === deck.id)?.tags.find((t) => /^lesson-\d+$/i.test(t));
  return tag ? `Unlock ${lessonLabel(tag)}` : `Unlock “${deck.name}”`;
}

function LockedDecks() {
  const data = useLiveQuery(async () => ({ decks: (await listDecks()).filter((d) => d.locked), notes: await listNotes() }), []);
  if (!data?.decks.length) return null;
  return (
    <div className="card">
      <h2>Coming soon</h2>
      {data.decks.map((d) => {
        const count = data.notes.filter((n) => n.deckId === d.id).length;
        return (
          <div key={d.id}>
            <p>
              <strong>{d.name}</strong>: {count} words waiting. They stay out of your reviews until you unlock them.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.confirm(`Unlock “${d.name}”? Its ${count} words will start arriving as new cards.`) && void unlockDeck(d.id)}
            >
              {unlockLabel(d, data.notes)}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function NotesList() {
  const pages = useLiveQuery(listGrammarPages, []);
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  return (
    <>
      <ul className="list">
        {pages?.map((p) => (
          <li key={p.id} className="list-item">
            <Link className="list-link" to={`/grammar/${p.slug}`}>
              <span className="list-title">{p.title}</span>
            </Link>
          </li>
        ))}
      </ul>
      {pages?.length === 0 && <p className="muted">No pages yet.</p>}
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          void createGrammarPage(title).then((p) => navigate(`/grammar/${p.slug}`));
        }}
      >
        <Field label="New page" hint="Start a page for a future lesson, then paste your notes into it.">
          <input type="text" value={title} placeholder="Irregular verbs" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <button type="submit" className="btn" disabled={!title.trim()}>
          Create page
        </button>
      </form>
      <LockedDecks />
    </>
  );
}

// ---------- mistake log ----------

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function MistakeLog() {
  const mistakes = useLiveQuery(listMistakes, []);
  const [open, setOpen] = useState(false);
  const [wrote, setWrote] = useState('');
  const [correct, setCorrect] = useState('');
  const [context, setContext] = useState('');
  const [tags, setTags] = useState<string[]>(['my-mistake']);
  const [topic, setTopic] = useState('');
  const [formKey, setFormKey] = useState(0);
  const form = useRef<HTMLFormElement>(null);

  const add = async () => {
    if (!wrote.trim() || !correct.trim()) return;
    await addMistake({ at: Date.now(), cardId: null, noteId: null, prompt: context.trim(), typed: wrote.trim(), correct: correct.trim(), tags, topic: topic || null, manual: true });
    setWrote('');
    setCorrect('');
    setContext('');
    setFormKey((k) => k + 1);
  };

  return (
    <>
      <p className="muted">Every card you mark Again lands here with what you typed. You can add your own, for example from a worksheet.</p>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Close' : 'Add a mistake by hand'}
      </button>
      {open && (
        <form
          ref={form}
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <SwedishKeys container={form} />
          <Field label="What I wrote">
            <input type="text" lang="sv" autoCapitalize="none" spellCheck={false} value={wrote} onChange={(e) => setWrote(e.target.value)} />
          </Field>
          <Field label="Correct version">
            <input type="text" lang="sv" autoCapitalize="none" spellCheck={false} value={correct} onChange={(e) => setCorrect(e.target.value)} />
          </Field>
          <Field label="Where it came from (optional)">
            <input type="text" value={context} placeholder="Lesson 6 worksheet, part 4" onChange={(e) => setContext(e.target.value)} />
          </Field>
          <Field label="Rule">
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">No rule page</option>
              {TOPICS.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tags">
            <TagsInput key={formKey} tags={tags} onChange={setTags} />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={!wrote.trim() || !correct.trim()}>
            Add to the log
          </button>
        </form>
      )}

      <h2>{mistakes ? `${mistakes.length} logged` : 'Loading…'}</h2>
      <ul className="list">
        {mistakes?.slice(0, 200).map((m) => (
          <li key={m.id} className="list-item word">
            <div className="word-forms">
              {day(m.at)}
              {m.manual ? ' · added by hand' : ''}
            </div>
            {m.prompt && <div className="word-example">{m.prompt}</div>}
            <div className="mistake-pair" lang="sv">
              <span className="seg-bad">{m.typed || '(no answer typed)'}</span>
              <span aria-hidden="true">→</span>
              <span className="seg-miss">{m.correct}</span>
            </div>
            <div className="word-foot">
              <div className="word-tags">
                {m.tags.map((t) => (
                  <span key={t} className="pill pill-tag">
                    #{t}
                  </span>
                ))}
                {m.topic && (
                  <Link className="pill pill-btn" to={`/grammar/${m.topic}`}>
                    Rule: {topicTitle(m.topic) ?? m.topic}
                  </Link>
                )}
              </div>
              <div className="actions">
                {m.noteId && (
                  <Link className="btn btn-small" to={`/edit/${m.noteId}`}>
                    Card
                  </Link>
                )}
                <button type="button" className="btn btn-small" aria-label="Remove this entry from the log" onClick={() => void removeMistake(m.id)}>
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {mistakes?.length === 0 && <p className="muted">Nothing logged yet. Bra jobbat!</p>}
    </>
  );
}

// ---------- weak spots ----------

function WeakSpots() {
  const [copied, setCopied] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const data = useLiveQuery(async () => {
    const [reviews, mistakes, notes, cards] = await Promise.all([listReviews(0), listMistakes(), listNotes(), listCards()]);
    const stats = computeWeakSpots({ reviews, mistakes, notes, cards, now: Date.now() });
    return { stats, ids: weakSpotCardIds(stats, cards, notes) };
  }, []);
  if (!data) return <p className="muted">Loading…</p>;
  const { stats, ids } = data;

  const doExport = async () => {
    const md = exportForClaude(stats, Date.now());
    setText(md);
    try {
      await navigator.clipboard.writeText(md);
      setCopied('Copied. Paste it into your lesson chat.');
    } catch {
      setCopied('Could not copy automatically. Select the text below and copy it.');
    }
  };

  return (
    <>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-num">{stats.reviewsThisWeek}</span>
          <span className="stat-label">Reviews, 7 days</span>
        </div>
        <div className="stat">
          <span className="stat-num">{stats.failsThisWeek}</span>
          <span className="stat-label">Again, 7 days</span>
        </div>
        <div className="stat">
          <span className="stat-num">{stats.cards.length}</span>
          <span className="stat-label">Cards failed</span>
        </div>
      </div>

      <Link className={`btn btn-primary btn-big ${ids.length === 0 ? 'is-disabled' : ''}`} to="/study?weak=1" aria-disabled={ids.length === 0}>
        Study weak spots ({ids.length} cards)
      </Link>
      <p className="muted small">Your most-failed cards, cards with your weakest tags, and your my-mistake cards. Extra practice: it does not change the schedule.</p>

      <div className="actions">
        <button type="button" className="btn" onClick={() => void doExport()}>
          Export for Claude
        </button>
        {copied && (
          <span className="small" role="status">
            {copied}
          </span>
        )}
      </div>
      {text && <textarea className="paste-box" rows={10} readOnly value={text} aria-label="Weak spots summary" onFocus={(e) => e.target.select()} />}

      <h2>Weakest tags</h2>
      {stats.tags.length === 0 ? (
        <p className="muted">No misses yet. They show up here as you study.</p>
      ) : (
        <ul className="list">
          {stats.tags.slice(0, 10).map((t) => (
            <li key={t.tag} className="list-item">
              <Link className="list-link bar-row" to={`/study?tag=${encodeURIComponent(t.tag)}`}>
                <span className="list-title">#{t.tag}</span>
                <span className="pill pill-warn">
                  {t.fails} miss{t.fails === 1 ? '' : 'es'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2>Most-failed cards</h2>
      {stats.cards.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul className="list">
          {stats.cards.slice(0, 15).map((c) => (
            <li key={c.cardId} className="list-item word">
              <div className="word-main">
                <span className="word-sv">{c.prompt}</span>
                <span className="pill pill-warn">failed {c.fails}×</span>
              </div>
              <div className="word-example seg-miss" lang="sv">
                {c.correct}
              </div>
              {c.typed.length > 0 && (
                <div className="word-forms" lang="sv">
                  You typed: {c.typed.slice(0, 3).join(' · ')}
                </div>
              )}
              <div className="word-foot">
                <span />
                <Link className="btn btn-small" to={`/edit/${c.noteId}`}>
                  Edit card
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <LockedDecks />
    </>
  );
}

// ---------- verb drill ----------

interface DrillResult {
  verb: DrillVerb;
  form: VerbForm;
  answer: Answer;
}

/** From the verb table: drill exactly these verbs, the heavier ones more often, with the forms mixed. */
export interface DrillPreset {
  verbs: DrillVerb[];
  weight: (v: DrillVerb) => number;
  onExit: () => void;
}

const presetQueue = (preset: DrillPreset, count: number) =>
  weightedPick(preset.verbs, preset.weight, count).flatMap((verb) => {
    const f = pickForm(verb);
    return f ? [{ verb, form: f }] : [];
  });

export function VerbDrill({ preset }: { preset?: DrillPreset }) {
  const loaded = useLiveQuery(async () => {
    const [notes, cards] = await Promise.all([listNotes(), listCards()]);
    const active = new Set(cards.filter((c) => !c.suspended).map((c) => c.noteId));
    return { verbs: drillVerbs(notes, new Set(notes.filter((n) => !active.has(n.id)).map((n) => n.id))), reasons: buildReasonContext(notes) };
  }, []);
  const verbs = loaded?.verbs;
  const lessons = useMemo(() => [...new Set((verbs ?? []).map((v) => v.lesson))].sort(), [verbs]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [size, setSize] = useState(10);
  const [form, setForm] = useState<VerbForm>('past');
  const [queue, setQueue] = useState<{ verb: DrillVerb; form: VerbForm }[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [results, setResults] = useState<DrillResult[]>([]);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const started = useRef(false);
  useActivity('lessons');
  // Coming from the verb table, the drill starts straight away.
  useEffect(() => {
    if (!preset || started.current) return;
    started.current = true;
    setQueue(presetQueue(preset, 10));
  }, [preset]);

  useEffect(() => {
    if (answer) nextBtn.current?.focus();
  }, [answer]);

  if (!verbs) return <p className="muted">Loading…</p>;
  if (verbs.length === 0 && !preset) return <p className="muted">No verbs with a past form yet. Load the starter lessons from Add → Files.</p>;
  // Every lesson to begin with; a verb only counts if it has the form being drilled.
  const chosen = picked ?? lessons;
  const pool = verbs.filter((v) => chosen.includes(v.lesson) && v[form]);

  const start = () => {
    if (preset) setQueue(presetQueue(preset, size || preset.verbs.length));
    else setQueue(shuffled(pool).slice(0, size || pool.length).map((verb) => ({ verb, form })));
    setIndex(0);
    setAnswer(null);
    setResults([]);
  };
  if (preset && !queue) return <p className="muted">Loading…</p>;

  if (!queue)
    return (
      <>
        <p className="muted">You see the infinitive, you type the form you chose. For the past tense you also get the stem-ending rule that decides it.</p>
        <label className="field">
          <span className="field-label">Form</span>
          <select value={form} onChange={(e) => setForm(e.target.value as VerbForm)}>
            {(Object.keys(VERB_FORM_LABELS) as VerbForm[]).map((f) => (
              <option key={f} value={f}>
                {VERB_FORM_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="checks">
          <legend className="field-label">Lessons</legend>
          {lessons.map((l) => (
            <label key={l} className="check">
              <input type="checkbox" checked={chosen.includes(l)} onChange={(e) => setPicked(e.target.checked ? [...chosen, l] : chosen.filter((x) => x !== l))} />
              {lessonLabel(l)} ({verbs.filter((v) => v.lesson === l && v[form]).length})
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span className="field-label">How many</span>
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
            <option value={10}>10 verbs</option>
            <option value={20}>20 verbs</option>
            <option value={0}>All {pool.length}</option>
          </select>
        </label>
        <button type="button" className="btn btn-primary btn-big" disabled={pool.length === 0} onClick={start}>
          Start drill
        </button>
      </>
    );

  if (index >= queue.length) {
    const misses = results.filter((r) => r.answer.check?.verdict !== 'correct');
    return (
      <div className="card" role="status">
        <h2>
          {results.length - misses.length} of {results.length} right
        </h2>
        {misses.length > 0 && (
          <ul>
            {misses.map((r) => (
              <li key={`${r.verb.noteId}:${r.form}`} lang="sv">
                {r.verb.infinitive} → <strong>{r.verb[r.form]}</strong>
                {r.answer.typed.trim() ? ` (you typed ${r.answer.typed.trim()})` : ''}
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={start}>
            Drill again
          </button>
          <button type="button" className="btn" onClick={() => (preset ? preset.onExit() : setQueue(null))}>
            {preset ? 'Back to the verb table' : 'Change lessons'}
          </button>
        </div>
      </div>
    );
  }

  const { verb, form: asked } = queue[index];
  const target = verb[asked];
  const rule = asked === 'past' ? pastRule(verb.infinitive, verb.past) : null;
  const formName = VERB_FORM_LABELS[asked].replace(/ \(.*$/, '');
  const submit = (typed: string, skipped = false) => {
    const check = checkAnswer(typed, [target]);
    const a: Answer = withReason({ typed, check: skipped ? { ...check, verdict: 'wrong' } : check }, loaded?.reasons ?? null);
    setAnswer(a);
    setResults((r) => [...r, { verb, form: asked, answer: a }]);
    if (a.check)
      void recordTyped(a.check.verdict, {
        prompt: `${formName} of ${verb.infinitive} (${verb.english})`,
        typed,
        correct: target,
        reason: a.reason?.text ?? rule?.text ?? '',
        tags: verb.tags,
        cardId: null,
        noteId: verb.noteId,
        source: 'verb-drill',
      });
    if (a.check?.verdict === 'wrong')
      void addMistake({
        at: Date.now(),
        cardId: null,
        noteId: verb.noteId,
        prompt: `Verb drill: ${formName.toLowerCase()} of ${verb.infinitive}`,
        typed: typed.trim(),
        correct: target,
        tags: verb.tags,
        topic: !rule ? null : rule.kind === 'ade' ? 'past-ade' : rule.kind === 'irregular' ? 'irregular' : 'past-te-de',
        manual: false,
      });
  };

  return (
    <div className="drill">
      <p className="muted small" role="status">
        {index + 1} of {queue.length}
      </p>
      <div className="study-card drill-card">
        <p className="face-type">{formName} of</p>
        <p className="face-main" lang="sv">
          {verb.infinitive}
        </p>
        <p className="face-sub">{verb.english}</p>
        {answer ? (
          <div className="back">
            <VerdictBox answer={answer} />
            <p className="face-answer" lang="sv">
              {verb.infinitive} → {target}
            </p>
            {rule ? (
              <p className="face-notes">
                <span className={`ending ending-${rule.kind === 'dde' ? 'de' : rule.kind}`}>{rule.kind === 'irregular' ? 'irregular' : `-${rule.kind}`}</span> {rule.text}
              </p>
            ) : (
              <p className="face-notes" lang="sv">
                {[verb.infinitive, verb.present, verb.past, verb.supine].filter(Boolean).join(', ')}
              </p>
            )}
            <button
              ref={nextBtn}
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setAnswer(null);
                setIndex(index + 1);
              }}
            >
              {index + 1 === queue.length ? 'See results' : 'Next verb'}
            </button>
          </div>
        ) : (
          <TypedInput key={index} label={`Type the ${formName.toLowerCase()}`} onSubmit={(t) => submit(t)} onSkip={() => submit('', true)} />
        )}
      </div>
      <button type="button" className="btn btn-small" onClick={() => (preset ? preset.onExit() : setQueue(null))}>
        Stop drill
      </button>
    </div>
  );
}

// ---------- the tab ----------

type Tab = 'notes' | 'mistakes' | 'weak' | 'verbs' | 'drill';
const TABS: { id: Tab; label: string }[] = [
  { id: 'notes', label: 'Notes' },
  { id: 'mistakes', label: 'Mistakes' },
  { id: 'weak', label: 'Weak spots' },
  { id: 'verbs', label: 'Verb table' },
  { id: 'drill', label: 'Verb drill' },
];

export function Grammar() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const page = useLiveQuery(async () => (slug ? ((await getGrammarPage(slug)) ?? null) : null), [slug]);

  if (slug)
    return (
      <section>
        <header className="page-head">
          <Link to="/grammar" className="back-link">
            ← Grammar notes
          </Link>
          <h1 className="sr-only">{page?.title ?? topicTitle(slug) ?? 'Grammar'}</h1>
        </header>
        <GrammarPageView key={slug} slug={slug} />
      </section>
    );

  const tab = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'notes';
  return (
    <section>
      <LearnNav />
      <header className="page-head">
        <h1>Grammar</h1>
      </header>
      <div className="tabs" role="tablist" aria-label="Grammar tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`gtab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="grammar-panel"
            className={tab === t.id ? 'tab-btn tab-btn-on' : 'tab-btn'}
            onClick={() => setParams({ tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="grammar-panel" role="tabpanel" aria-labelledby={`gtab-${tab}`}>
        {tab === 'notes' && <NotesList />}
        {tab === 'mistakes' && <MistakeLog />}
        {tab === 'weak' && <WeakSpots />}
        {tab === 'verbs' && <VerbTable />}
        {tab === 'drill' && <VerbDrill />}
      </div>
    </section>
  );
}
