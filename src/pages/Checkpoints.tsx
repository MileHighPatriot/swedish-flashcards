import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { SwedishKeys } from '../components/SwedishKeys';
import { CHECKPOINTS, type PlanCheckpoint } from '../data/plan';
import { deleteCheckpoint, getSettings, listCheckpoints, listLessons, listMistakeItems, listNotes, listTexts, recordTyped, saveCheckpoint, updateNote } from '../db/repo';
import type { Checkpoint, CheckpointItem, ID } from '../db/types';
import {
  RESULT_LABELS,
  SECTION_LABELS,
  SECTION_MINUTES,
  STATE_LABELS,
  blockLessons,
  checkpointState,
  checkpointTitle,
  clock,
  gradeItem,
  missesOf,
  pause,
  productionItems,
  readyForHarder,
  recallItems,
  resultOf,
  resume,
  reviewTagFor,
  scoreOf,
  sheetLine,
  speakingForTutor,
  speakingQuestions,
  startCountdown,
  tick,
  writingForTutor,
  writingTask,
  type Countdown,
  type Section,
  type TestItem,
  type WritingTask,
} from '../lib/checkpoint';
import type { CheckResult } from '../lib/check';
import { useActivity } from '../lib/activity';
import { useNow, useSettings } from '../lib/hooks';
import { blockWeeks, checkpointOf, isRealSitting, isoDate, latestSitting, lessonTagOf } from '../lib/plan';
import type { Prompt } from '../lib/prompts';
import { buildReasonContext, explainError, type ReasonContext } from '../lib/reasons';
import { BUILT_IN_TEXTS, parseText } from '../lib/texts';
import { SavedRecorder } from '../practice/shared';
import { SpeakButton, TypedInput, VerdictBox } from '../study/CardView';

const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n * 100)}%`);
const longDate = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'before the plan');

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A button that copies, says so, and shows the text to select when the clipboard is not available. */
function CopyButton({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  return (
    <div className="copy-block">
      <button type="button" className="btn" onClick={() => void copyText(text).then((ok) => setState(ok ? 'copied' : 'manual'))}>
        {label}
      </button>
      <span className="small" role="status">
        {state === 'copied' ? 'Copied.' : state === 'manual' ? 'Could not copy automatically. Select the text below and copy it.' : ''}
      </span>
      {state === 'manual' && <textarea className="paste-box" rows={4} readOnly value={text} aria-label={`${label}: text to copy`} onFocus={(e) => e.target.select()} />}
    </div>
  );
}

// ---------- the clock ----------

function useCountdown(minutes: number, onEnd: () => void) {
  const [c, setC] = useState<Countdown>(() => startCountdown(minutes));
  const end = useRef(onEnd);
  end.current = onEnd;
  useEffect(() => {
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      setC((prev) => tick(prev, dt));
    }, 250);
    return () => window.clearInterval(id);
  }, []);
  const fired = useRef(false);
  useEffect(() => {
    if (c.ended && !fired.current) {
      fired.current = true;
      end.current();
    }
  }, [c.ended]);
  return { c, toggle: () => setC((prev) => (prev.running ? pause(prev) : resume(prev))) };
}

function Clock({ section, c, onToggle }: { section: Section; c: Countdown; onToggle: () => void }) {
  // Spoken only at the moments that matter, not every second.
  const minutes = Math.ceil(c.remainingMs / 60_000);
  const say = c.ended ? 'Time is up.' : !c.running ? 'Paused.' : minutes === 5 ? '5 minutes left.' : minutes === 1 ? '1 minute left.' : '';
  return (
    <div className="cp-clock">
      <span className="cp-clock-label">
        {SECTION_LABELS[section]} · {SECTION_MINUTES[section]} min
      </span>
      <span className="cp-clock-time" role="timer" aria-label={`Time left in ${SECTION_LABELS[section]}`}>
        {clock(c.remainingMs)}
        {!c.running && !c.ended ? ' (paused)' : ''}
      </span>
      <button type="button" className="btn btn-small" onClick={onToggle} disabled={c.ended} aria-pressed={!c.running}>
        {c.running ? 'Pause' : 'Resume'}
      </button>
      <span className="sr-only" aria-live="polite">
        {say}
      </span>
    </div>
  );
}

// ---------- typed sections (recall, production) ----------

interface Answered {
  item: TestItem;
  typed: string;
  check: CheckResult;
}

function TypedSection({ section, items, onDone }: { section: 'recall' | 'production'; items: TestItem[]; onDone: (answers: Answered[]) => void }) {
  const [answers, setAnswers] = useState<Answered[]>([]);
  const latest = useRef<Answered[]>([]);
  latest.current = answers;
  const closed = useRef(false);
  // Whatever is left when the time runs out counts as not answered.
  const finish = (done: Answered[]) => {
    if (closed.current) return;
    closed.current = true;
    onDone([...done, ...items.slice(done.length).map((item) => ({ item, typed: '', check: { ...gradeItem(item, ''), verdict: 'wrong' as const } }))]);
  };
  const { c, toggle } = useCountdown(SECTION_MINUTES[section], () => finish(latest.current));
  useActivity('lessons');
  const index = answers.length;
  const item = items[index];

  const answer = (typed: string) => {
    const done = [...answers, { item, typed, check: typed.trim() ? gradeItem(item, typed) : { ...gradeItem(item, ''), verdict: 'wrong' as const } }];
    setAnswers(done);
    if (done.length === items.length) finish(done);
  };

  return (
    <div className="drill">
      <Clock section={section} c={c} onToggle={toggle} />
      {!item ? null : !c.running ? (
        <p className="notice">Paused. The questions are hidden until you resume.</p>
      ) : (
        <>
          <p className="muted small" role="status">
            {index + 1} of {items.length}
          </p>
          <div className="study-card drill-card">
            <p className="face-type">{item.label}</p>
            <p className="face-question">{item.prompt}</p>
            <TypedInput key={index} label="Type the Swedish" submitLabel="Next" skipLabel="Skip" onSubmit={answer} onSkip={() => answer('')} />
          </div>
          <p className="muted small">{section === 'production' ? 'Your answers are checked when the section ends.' : 'No feedback until the section ends, like a test.'}</p>
          <button type="button" className="btn btn-small" onClick={() => finish(answers)}>
            End this section now
          </button>
        </>
      )}
    </div>
  );
}

function Review({ section, answers, reasons, onNext }: { section: 'recall' | 'production'; answers: Answered[]; reasons: ReasonContext | null; onNext: () => void }) {
  const closeCounts = section === 'production';
  const score = scoreOf(answers.map((a) => a.check.verdict), closeCounts);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  return (
    <>
      <div className="card" role="status">
        <h2>
          {SECTION_LABELS[section]}: {pct(score)}
        </h2>
        <p className="muted small">
          {answers.filter((a) => a.check.verdict === 'correct').length} right, {answers.filter((a) => a.check.verdict === 'close').length} close
          {closeCounts ? ' (counted as right, listed as “watch”)' : ' (not counted)'}, {answers.filter((a) => a.check.verdict === 'wrong').length} wrong.
        </p>
      </div>
      <ol className="list cp-review">
        {answers.map((a, i) => (
          <li key={i} className="list-item word">
            <div className="word-main">
              <span>{a.item.prompt}</span>
              <span className={`pill ${a.check.verdict === 'correct' ? 'pill-new' : 'pill-warn'}`}>{a.check.verdict === 'correct' ? 'Right' : a.check.verdict === 'close' ? 'Watch' : a.typed.trim() ? 'Wrong' : 'Not answered'}</span>
            </div>
            {a.check.verdict === 'correct' ? (
              <p lang="sv" className="mistake-line">
                {a.typed}
              </p>
            ) : (
              <VerdictBox answer={{ typed: a.typed, check: a.check, reason: reasons && a.typed.trim() && a.check.verdict === 'wrong' ? explainError(a.typed, a.check.expected, reasons) : null }} />
            )}
          </li>
        ))}
      </ol>
      <button ref={btn} type="button" className="btn btn-primary btn-big" onClick={onNext}>
        Continue
      </button>
    </>
  );
}

// ---------- writing ----------

function Writing({ cp, task, onDone }: { cp: string; task: WritingTask; onDone: (text: string, score: number) => void }) {
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0.7);
  const { c, toggle } = useCountdown(SECTION_MINUTES.writing, () => setOver(true));
  const box = useRef<HTMLDivElement>(null);
  useActivity('lessons');
  return (
    <div ref={box}>
      {!over && <Clock section="writing" c={c} onToggle={toggle} />}
      <div className="card">
        <h2>Writing task{task.lesson != null ? ` (from Lesson ${task.lesson})` : ''}</h2>
        <p className="cp-task">{task.task}</p>
      </div>
      {!over && <SwedishKeys container={box} />}
      <label className="field">
        <span className="field-label">Your text</span>
        <textarea rows={10} lang="sv" spellCheck={false} autoCapitalize="sentences" value={text} readOnly={over || !c.running} onChange={(e) => setText(e.target.value)} />
      </label>
      {!over ? (
        <button type="button" className="btn btn-primary" onClick={() => setOver(true)}>
          I am done writing
        </button>
      ) : (
        <div className="card">
          <h2>Check it yourself</h2>
          <p className="muted small">The app cannot grade free writing honestly, so this score is yours. Your tutor’s mark is the real one.</p>
          <fieldset className="checks">
            <legend className="field-label">Look for these in your text</legend>
            {task.selfCheck.map((s) => (
              <label key={s} className="check">
                <input type="checkbox" /> {s}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span className="field-label">My score for the writing (self-scored)</span>
            <select value={score} onChange={(e) => setScore(Number(e.target.value))}>
              {Array.from({ length: 11 }, (_, i) => i / 10).map((v) => (
                <option key={v} value={v}>
                  {v.toFixed(1)} ({Math.round(v * 100)}%)
                </option>
              ))}
            </select>
          </label>
          <CopyButton label="Copy for my tutor" text={writingForTutor({ cp, date: isoDate(Date.now()), task: task.task, text })} />
          <button type="button" className="btn btn-primary btn-big" onClick={() => onDone(text, score)}>
            Continue to speaking
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- speaking ----------

function Speaking({ cp, questions, onDone }: { cp: string; questions: Prompt[]; onDone: (x: { notes: string; audioIds: ID[]; withoutEnglish: boolean }) => void }) {
  const settings = useSettings();
  const [notes, setNotes] = useState('');
  const [audioIds, setAudioIds] = useState<ID[]>([]);
  const [over, setOver] = useState(false);
  const [carried, setCarried] = useState<'yes' | 'no' | ''>('');
  const { c, toggle } = useCountdown(SECTION_MINUTES.speaking, () => setOver(true));
  const box = useRef<HTMLDivElement>(null);
  useActivity('speaking');
  return (
    <div ref={box}>
      {!over && <Clock section="speaking" c={c} onToggle={toggle} />}
      <div className="card">
        <h2>Answer out loud, in Swedish</h2>
        <p className="muted small">Take them one at a time. Say as much as you can; do not switch to English. Record yourself, type notes, or both.</p>
        <ol className="cp-questions">
          {questions.map((q) => (
            <li key={q.sv}>
              <span lang="sv">{q.sv}</span> <SpeakButton text={q.sv} rate={settings.ttsRate} slowRate={settings.ttsSlowRate} label={`Hear the question: ${q.sv}`} />
              {q.en && <span className="muted small"> {q.en}</span>}
            </li>
          ))}
        </ol>
      </div>
      <SavedRecorder ids={audioIds} onChange={setAudioIds} what="answer" />
      <SwedishKeys container={box} />
      <label className="field">
        <span className="field-label">Notes (optional): what you said, words you were missing</span>
        <textarea rows={5} lang="sv" spellCheck={false} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {!over ? (
        <button type="button" className="btn btn-primary" onClick={() => setOver(true)}>
          I am done speaking
        </button>
      ) : (
        <div className="card">
          <fieldset className="checks">
            <legend className="field-label">Did you carry it without switching to English?</legend>
            {(['yes', 'no'] as const).map((v) => (
              <label key={v} className="check">
                <input type="radio" name="carried" value={v} checked={carried === v} onChange={() => setCarried(v)} /> {v === 'yes' ? 'Yes' : 'No'}
              </label>
            ))}
          </fieldset>
          <p className="muted small">There is no automatic speaking score. Your answer here decides the speaking half of the result.</p>
          <CopyButton label="Copy for my tutor" text={speakingForTutor({ cp, date: isoDate(Date.now()), questions: questions.map((q) => q.sv), notes, recordings: audioIds.length })} />
          <button type="button" className="btn btn-primary btn-big" disabled={!carried} onClick={() => onDone({ notes, audioIds, withoutEnglish: carried === 'yes' })}>
            See my result
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- one sitting ----------

interface Loaded {
  recall: TestItem[];
  production: TestItem[];
  writing: WritingTask;
  speaking: Prompt[];
  reasons: ReasonContext;
}

type Stage = 'intro' | 'recall' | 'recall-review' | 'production' | 'production-review' | 'writing' | 'speaking' | 'result';

function ResultCard({ row, plan }: { row: Checkpoint; plan: PlanCheckpoint | undefined }) {
  const misses = missesOf(row.items);
  const watch = row.items.filter((i) => i.verdict === 'close');
  return (
    <>
      <div className="card" role="status">
        <h2>
          {row.practice ? 'Practice run: ' : ''}
          {row.result ? RESULT_LABELS[row.result] : 'No result'}
        </h2>
        {plan?.gate && <p className="cp-gate">{plan.gate}</p>}
        <dl className="cp-scores">
          <div>
            <dt>Recall</dt>
            <dd>{pct(row.recall)}</dd>
          </div>
          <div>
            <dt>Production</dt>
            <dd>{pct(row.production)}</dd>
          </div>
          <div>
            <dt>Writing{row.writingSelfScored ? ' (self-scored)' : ''}</dt>
            <dd>{pct(row.writing)}</dd>
          </div>
          <div>
            <dt>Speaking without English</dt>
            <dd>{row.speakingWithoutEnglish == null ? '–' : row.speakingWithoutEnglish ? 'yes' : 'no'}</dd>
          </div>
        </dl>
        <p className="muted small">Pass = 80% or more on production and the speaking part carried without English. 70% to 80%: next week is rebuilt around the misses. Under 70%: repeat the block.</p>
        {row.practice && <p className="small">Saved as a practice run. It does not count as the checkpoint’s result.</p>}
        {!row.practice && row.result === 'close' && (
          <p>
            Your misses are tagged <code>{row.reviewTag}</code>, added to My mistakes, and come up in next week’s “This week’s lesson”.
          </p>
        )}
        {row.result === 'repeat' && (
          <Link className="btn" to={`/study?tags=${blockLessons(row.cp).map(lessonTagOf).join(',')}`}>
            Study this block again (lessons {blockLessons(row.cp)[0]} to {blockLessons(row.cp).slice(-1)[0]})
          </Link>
        )}
        <CopyButton label="Copy for my sheet" text={sheetLine(row)} />
      </div>
      {misses.length > 0 && (
        <div className="card">
          <h2>Misses ({misses.length})</h2>
          <ul>
            {misses.map((m, i) => (
              <li key={i}>
                {m.prompt} <strong lang="sv">{m.expected}</strong>
                {m.typed.trim() ? <span lang="sv"> (you wrote: {m.typed.trim()})</span> : ' (not answered)'}
                {m.reason && <span className="muted small"> {m.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {watch.length > 0 && (
        <div className="card">
          <h2>Watch ({watch.length})</h2>
          <ul>
            {watch.map((m, i) => (
              <li key={i} lang="sv">
                {m.typed.trim()} → <strong>{m.expected}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Run({ cp, practice }: { cp: PlanCheckpoint; practice: boolean }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [stage, setStage] = useState<Stage>('intro');
  const [recall, setRecall] = useState<Answered[]>([]);
  const [production, setProduction] = useState<Answered[]>([]);
  const [writing, setWriting] = useState<{ text: string; score: number } | null>(null);
  const [row, setRow] = useState<Checkpoint | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [notes, mine, items, lessons, settings] = await Promise.all([listNotes(), listTexts(), listMistakeItems(), listLessons(), getSettings()]);
      if (!live) return;
      const texts = [...mine.map((t) => parseText(t.body, t.id, false, t.title)), ...BUILT_IN_TEXTS];
      const input = { cp: cp.cp, notes, texts, items, lessons, now: Date.now(), dayStartHour: settings.dayStartHour };
      setData({ recall: recallItems(input), production: productionItems(input), writing: writingTask(cp.cp, lessons), speaking: speakingQuestions(cp.cp, lessons), reasons: buildReasonContext(notes) });
    })();
    return () => {
      live = false;
    };
  }, [cp.cp]);

  useEffect(() => {
    if (stage === 'intro' || stage === 'result') return;
    document.body.classList.add('in-session');
    return () => document.body.classList.remove('in-session');
  }, [stage]);

  if (!data) return <p className="muted">Loading…</p>;

  const finish = async (speaking: { notes: string; audioIds: ID[]; withoutEnglish: boolean }) => {
    const toItem = (a: Answered): CheckpointItem => ({
      section: a.item.section,
      prompt: a.item.prompt,
      typed: a.typed,
      expected: a.check.expected,
      verdict: a.check.verdict,
      noteId: a.item.noteId,
      reason: a.typed.trim() && a.check.verdict === 'wrong' ? (explainError(a.typed, a.check.expected, data.reasons)?.text ?? '') : '',
    });
    const all = [...recall, ...production];
    const productionScore = scoreOf(production.map((a) => a.check.verdict), true);
    const result = resultOf(productionScore, speaking.withoutEnglish);
    const tag = !practice && result === 'close' ? reviewTagFor(cp.cp) : null;
    const saved = await saveCheckpoint({
      cp: cp.cp,
      kind: 'app',
      label: checkpointTitle(cp.cp),
      week: cp.week,
      date: isoDate(Date.now()),
      at: Date.now(),
      practice,
      recall: scoreOf(recall.map((a) => a.check.verdict), false),
      production: productionScore,
      writing: writing?.score ?? null,
      writingSelfScored: true,
      speakingWithoutEnglish: speaking.withoutEnglish,
      result,
      items: all.map(toItem),
      reviewTag: tag,
      writingTask: data.writing.task,
      writingText: writing?.text ?? '',
      speakingQuestions: data.speaking.map((q) => q.sv),
      speakingNotes: speaking.notes,
      audioIds: speaking.audioIds,
    });
    // Every typed answer feeds My mistakes, practice run or not.
    for (const a of all)
      await recordTyped(a.check.verdict, {
        prompt: a.item.mistake?.prompt ?? a.item.prompt,
        typed: a.typed,
        correct: a.item.mistake?.correct ?? a.item.answers.join(' // '),
        reason: toItem(a).reason || a.item.mistake?.reason || '',
        tags: a.item.tags,
        cardId: a.item.mistake?.cardId ?? a.item.cardId,
        noteId: a.item.noteId,
        source: 'checkpoint',
      });
    // A real "Close": the cards I missed carry the review tag into next week's session.
    if (tag) {
      const notes = new Map((await listNotes()).map((n) => [n.id, n]));
      for (const id of new Set(all.filter((a) => a.check.verdict === 'wrong' && a.item.noteId).map((a) => a.item.noteId!))) {
        const n = notes.get(id);
        if (n && !n.tags.includes(tag)) await updateNote(id, { tags: [...n.tags, tag] });
      }
    }
    setRow(saved);
    setStage('result');
  };

  if (stage === 'intro')
    return (
      <div className="card">
        <h2>
          {checkpointTitle(cp.cp)}
          {practice ? ' (practice run)' : ''}
        </h2>
        {cp.gate && <p className="cp-gate">{cp.gate}</p>}
        <p>
          75 minutes in four timed parts. Each part has a clock and a pause button; when the time runs out the part ends.
        </p>
        <ol>
          <li>
            <strong>Recall, 15 min:</strong> {data.recall.length} words, verb forms and open mistakes from English cues.
          </li>
          <li>
            <strong>Production, 20 min:</strong> {data.production.length} sentences to translate and blanks to fill. Checked when the part ends.
          </li>
          <li>
            <strong>Writing, 20 min:</strong> one task, scored by you and copied for your tutor.
          </li>
          <li>
            <strong>Speaking, 20 min:</strong> {data.speaking.length} questions to answer out loud.
          </li>
        </ol>
        <p className="muted small">
          It covers weeks {blockWeeks(cp.cp)[0]} to {blockWeeks(cp.cp).slice(-1)[0]} of the plan (lessons {blockLessons(cp.cp)[0]} to {blockLessons(cp.cp).slice(-1)[0]}).{' '}
          {practice ? 'A practice run is saved in the history but never counts as the result.' : 'This sitting is saved as the real result.'}
        </p>
        {data.recall.length + data.production.length === 0 && <p className="notice">You have no cards from this block yet, so the typed parts are empty. Import the lessons first.</p>}
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setStage('recall')}>
            Start: recall
          </button>
          <Link className="btn" to="/checkpoints">
            Not now
          </Link>
        </div>
      </div>
    );

  if (stage === 'recall')
    return data.recall.length ? (
      <TypedSection
        section="recall"
        items={data.recall}
        onDone={(a) => {
          setRecall(a);
          setStage('recall-review');
        }}
      />
    ) : (
      <Skip what="recall" onNext={() => setStage('production')} />
    );
  if (stage === 'recall-review') return <Review section="recall" answers={recall} reasons={data.reasons} onNext={() => setStage('production')} />;
  if (stage === 'production')
    return data.production.length ? (
      <TypedSection
        section="production"
        items={data.production}
        onDone={(a) => {
          setProduction(a);
          setStage('production-review');
        }}
      />
    ) : (
      <Skip what="production" onNext={() => setStage('writing')} />
    );
  if (stage === 'production-review') return <Review section="production" answers={production} reasons={data.reasons} onNext={() => setStage('writing')} />;
  if (stage === 'writing')
    return (
      <Writing
        cp={cp.cp}
        task={data.writing}
        onDone={(text, score) => {
          setWriting({ text, score });
          setStage('speaking');
        }}
      />
    );
  if (stage === 'speaking') return <Speaking cp={cp.cp} questions={data.speaking} onDone={(x) => void finish(x)} />;

  return (
    <>
      {row && <ResultCard row={row} plan={cp} />}
      <Link className="btn btn-primary btn-big" to="/checkpoints">
        Back to checkpoints
      </Link>
    </>
  );
}

function Skip({ what, onNext }: { what: string; onNext: () => void }) {
  return (
    <div className="card">
      <p>There is nothing to ask in the {what} part yet: no cards from this block.</p>
      <button type="button" className="btn btn-primary" onClick={onNext}>
        Continue
      </button>
    </div>
  );
}

// ---------- overview, history, paper results ----------

function PaperForm({ onSaved }: { onSaved: () => void }) {
  const [cp, setCp] = useState('CP1');
  const [date, setDate] = useState(isoDate(Date.now()));
  const [recall, setRecall] = useState('');
  const [production, setProduction] = useState('');
  const [writing, setWriting] = useState('');
  const [carried, setCarried] = useState<'yes' | 'no'>('yes');
  const num = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Math.min(100, Math.max(0, Number(v))) / 100);
  const save = async () => {
    const p = num(production);
    await saveCheckpoint({
      cp,
      kind: 'paper',
      label: `${checkpointTitle(cp)} (on paper)`,
      week: checkpointOf(cp)?.week ?? null,
      date,
      at: new Date(`${date}T12:00:00`).getTime(),
      practice: false,
      recall: num(recall),
      production: p,
      writing: num(writing),
      writingSelfScored: false,
      speakingWithoutEnglish: carried === 'yes',
      result: resultOf(p, carried === 'yes'),
      items: [],
      reviewTag: null,
    });
    setRecall('');
    setProduction('');
    setWriting('');
    onSaved();
  };
  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="field">
      <span className="field-label">{label} (%)</span>
      <input type="number" inputMode="numeric" min={0} max={100} value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2>Enter a paper checkpoint</h2>
      <div className="field-grid">
        <label className="field">
          <span className="field-label">Checkpoint</span>
          <select value={cp} onChange={(e) => setCp(e.target.value)}>
            {CHECKPOINTS.map((c) => (
              <option key={c.cp} value={c.cp}>
                {checkpointTitle(c.cp)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Date taken</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {field('Recall', recall, setRecall)}
        {field('Production', production, setProduction)}
        {field('Writing', writing, setWriting)}
        <label className="field">
          <span className="field-label">Speaking without English</span>
          <select value={carried} onChange={(e) => setCarried(e.target.value as 'yes' | 'no')}>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
      </div>
      <button type="submit" className="btn btn-primary" disabled={production.trim() === ''}>
        Save the result
      </button>
    </form>
  );
}

function Overview() {
  const now = useNow();
  const rows = useLiveQuery(listCheckpoints, []);
  const [paper, setPaper] = useState(false);
  const history = useMemo(() => (rows ?? []).filter((r) => r.kind !== 'dismissed'), [rows]);
  if (!rows) return <p className="muted">Loading…</p>;
  const scored = history.filter((r) => r.production != null);

  return (
    <>
      {readyForHarder(rows) && (
        <p className="notice" role="status">
          <strong>Ready for harder lessons: tell Claude.</strong> Two checkpoints in a row over 90% on production.
        </p>
      )}
      <ul className="list">
        {CHECKPOINTS.map((cp) => {
          const state = checkpointState(cp, now, rows);
          const sat = latestSitting(rows, cp.cp);
          const open = state === 'this-week' || state === 'due' || state === 'not-taken';
          return (
            <li key={cp.cp} className={`list-item word ${open ? 'cp-open' : ''}`}>
              <div className="word-main">
                <span>
                  <strong>{checkpointTitle(cp.cp)}</strong> <span className="muted">· week {cp.week}</span>
                </span>
                <span className={`pill ${open ? 'pill-warn' : state === 'taken' ? 'pill-new' : ''}`}>{sat?.result ? RESULT_LABELS[sat.result] : STATE_LABELS[state]}</span>
              </div>
              <div className="word-forms">
                {longDate(cp.date)}
                {cp.gate ? ` · ${cp.gate}` : ''}
                {sat ? ` · production ${pct(sat.production)}` : ''}
              </div>
              <div className="actions">
                {state !== 'upcoming' && (
                  <Link className={open ? 'btn btn-small btn-primary' : 'btn btn-small'} to={`/checkpoints/${cp.cp}`}>
                    {sat ? 'Take it again' : 'Take it'}
                  </Link>
                )}
                <Link className="btn btn-small" to={`/checkpoints/${cp.cp}?practice=1`}>
                  Practice run
                </Link>
                {state === 'not-taken' && (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() =>
                      void saveCheckpoint({ cp: cp.cp, kind: 'dismissed', label: checkpointTitle(cp.cp), week: cp.week, date: isoDate(Date.now()), at: Date.now(), practice: false, recall: null, production: null, writing: null, writingSelfScored: false, speakingWithoutEnglish: null, result: null, items: [], reviewTag: null })
                    }
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <button type="button" className="btn" aria-expanded={paper} onClick={() => setPaper(!paper)}>
        {paper ? 'Close' : 'Enter a paper checkpoint by hand'}
      </button>
      {paper && <PaperForm onSaved={() => setPaper(false)} />}

      <h2>Score history</h2>
      {history.length === 0 && <p className="muted">Nothing yet.</p>}
      {scored.length > 0 && (
        <div className="card">
          <h3>Production scores</h3>
          <ol className="cp-trend">
            {scored.map((r) => (
              <li key={r.id}>
                <span className="cp-trend-label">
                  {r.label}
                  {r.practice ? ' (practice)' : ''}
                </span>
                <span className="cp-trend-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(r.production! * 100)}%` }} className={r.kind === 'old-plan-paper' || r.practice ? 'is-aside' : ''} />
                </span>
                <span className="cp-trend-value">{pct(r.production)}</span>
              </li>
            ))}
          </ol>
          <p className="muted small">The pass mark is 80%. Old-plan worksheets and practice runs are shown for the record and never count toward a result.</p>
        </div>
      )}
      <ul className="list">
        {[...history].reverse().map((r) => (
          <li key={r.id} className="list-item word">
            <div className="word-main">
              <span>
                <strong>{r.label}</strong>
                {r.practice ? ' · practice run' : r.kind === 'old-plan-paper' ? ' · old plan, on paper' : r.kind === 'paper' ? ' · entered by hand' : ''}
              </span>
              {r.result && isRealSitting(r) && <span className="pill">{RESULT_LABELS[r.result]}</span>}
            </div>
            <div className="word-forms">
              {longDate(r.date)} · {r.kind === 'old-plan-paper' ? `score ${pct(r.production)}` : `recall ${pct(r.recall)} · production ${pct(r.production)} · writing ${pct(r.writing)}${r.writingSelfScored && r.writing != null ? ' (self-scored)' : ''} · speaking without English ${r.speakingWithoutEnglish == null ? '–' : r.speakingWithoutEnglish ? 'yes' : 'no'}`}
            </div>
            {r.kind !== 'old-plan-paper' && (
              <div className="actions">
                <CopyButton label="Copy for my sheet" text={sheetLine(r)} />
                <button type="button" className="btn btn-small" onClick={() => window.confirm(`Delete this result (${r.label}, ${r.date})?`) && void deleteCheckpoint(r.id)}>
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export function Checkpoints() {
  const { cp: id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cp = id ? checkpointOf(id) : undefined;
  useEffect(() => {
    if (id && !cp) navigate('/checkpoints', { replace: true });
  }, [id, cp, navigate]);

  return (
    <section>
      <header className="page-head">
        <Link to={cp ? '/checkpoints' : '/'} className="back-link">
          {cp ? '← Checkpoints' : '← Home'}
        </Link>
        <h1>{cp ? checkpointTitle(cp.cp) : 'Checkpoints'}</h1>
        {!cp && <p className="muted">The 14 Sunday checkpoints and the Final from your B2 plan. Each is a 75-minute test: recall 15, production 20, writing 20, speaking 20.</p>}
      </header>
      {cp ? <Run key={`${cp.cp}:${params.get('practice')}`} cp={cp} practice={params.get('practice') === '1'} /> : <Overview />}
    </section>
  );
}
