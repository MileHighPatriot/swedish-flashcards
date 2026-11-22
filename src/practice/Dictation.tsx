import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { addMistake, recordTyped } from '../db/repo';
import { checkAnswer } from '../lib/check';
import { useSettings } from '../lib/hooks';
import type { Sentence } from '../lib/practice';
import { shuffled } from '../lib/queue';
import { say } from '../lib/speech';
import { SpeakButton, TypedInput, VerdictBox, withReason, type Answer } from '../study/CardView';
import { ALL, LessonSelect, inLesson, useReasons, useSentences } from './shared';

export function Dictation() {
  const settings = useSettings();
  const sentences = useSentences();
  const reasons = useReasons();
  const [lesson, setLesson] = useState(ALL);
  const [size, setSize] = useState(10);
  const [queue, setQueue] = useState<Sentence[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [results, setResults] = useState<{ item: Sentence; answer: Answer }[]>([]);
  const nextBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (answer) nextBtn.current?.focus();
  }, [answer]);

  if (!sentences) return <p className="muted">Loading…</p>;
  if (sentences.length === 0) return <p className="muted">No sentences yet. They come from the example sentences and phrases on your cards.</p>;
  const pool = inLesson(sentences, lesson);

  const start = () => {
    const q = shuffled(pool).slice(0, size || pool.length);
    setQueue(q);
    setIndex(0);
    setAnswer(null);
    setResults([]);
    if (q[0]) say(q[0].sv, settings.ttsRate);
  };

  if (!queue)
    return (
      <>
        <p className="muted">You hear a sentence from your own cards and type what you heard. It trains your ear and your spelling together.</p>
        <LessonSelect items={sentences} value={lesson} onChange={setLesson} />
        <label className="field">
          <span className="field-label">How many</span>
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
            <option value={5}>5 sentences</option>
            <option value={10}>10 sentences</option>
            <option value={20}>20 sentences</option>
            <option value={0}>All {pool.length}</option>
          </select>
        </label>
        <button type="button" className="btn btn-primary btn-big" disabled={pool.length === 0} onClick={start}>
          Start dictation
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
              <li key={r.item.sv} lang="sv">
                <strong>{r.item.sv}</strong>
                {r.answer.typed.trim() ? ` (you typed: ${r.answer.typed.trim()})` : ''}
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={start}>
            Go again
          </button>
          <button type="button" className="btn" onClick={() => setQueue(null)}>
            Change lesson
          </button>
          <Link className="btn" to="/practice">
            Done
          </Link>
        </div>
      </div>
    );
  }

  const item = queue[index];
  const submit = (typed: string, skipped = false) => {
    const check = checkAnswer(typed, [item.sv]);
    const a: Answer = withReason({ typed, check: skipped ? { ...check, verdict: 'wrong' } : check }, reasons ?? null);
    setAnswer(a);
    setResults((r) => [...r, { item, answer: a }]);
    if (a.check)
      void recordTyped(a.check.verdict, {
        prompt: item.en || 'Listen and type',
        typed,
        correct: item.sv,
        reason: a.reason?.text ?? '',
        tags: [...new Set([...item.tags, 'dictation'])],
        cardId: null,
        noteId: item.noteId,
        source: 'dictation',
      });
    if (a.check?.verdict === 'wrong')
      void addMistake({
        at: Date.now(),
        cardId: null,
        noteId: item.noteId,
        prompt: 'Dictation: typed what I heard',
        typed: typed.trim(),
        correct: item.sv,
        tags: [...new Set([...item.tags, 'dictation'])],
        topic: null,
        manual: false,
      });
  };
  const next = () => {
    setAnswer(null);
    setIndex(index + 1);
    const upcoming = queue[index + 1];
    if (upcoming) say(upcoming.sv, settings.ttsRate);
  };

  return (
    <div className="drill">
      <p className="muted small" role="status">
        {index + 1} of {queue.length}
      </p>
      <div className="study-card drill-card">
        <p className="face-type">Listen and type</p>
        <SpeakButton text={item.sv} rate={settings.ttsRate} slowRate={settings.ttsSlowRate} label="Play the sentence" />
        {answer ? (
          <div className="back">
            <VerdictBox answer={answer} />
            <p className="face-answer" lang="sv">
              {item.sv}
            </p>
            {item.en && <p className="face-sub">{item.en}</p>}
            <button ref={nextBtn} type="button" className="btn btn-primary" onClick={next}>
              {index + 1 === queue.length ? 'See results' : 'Next sentence'}
            </button>
          </div>
        ) : (
          <TypedInput key={index} label="Type what you hear" onSubmit={(t) => submit(t)} onSkip={() => submit('', true)} />
        )}
      </div>
      <button type="button" className="btn btn-small" onClick={() => setQueue(null)}>
        Stop
      </button>
    </div>
  );
}
