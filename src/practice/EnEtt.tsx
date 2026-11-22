import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addMistake, recordTyped } from '../db/repo';
import { drillNouns, type DrillNoun } from '../lib/practice';
import { shuffled } from '../lib/queue';
import { ALL, LessonSelect, inLesson, useNotes } from './shared';

export function EnEtt() {
  const data = useNotes();
  const [lesson, setLesson] = useState(ALL);
  const [queue, setQueue] = useState<DrillNoun[] | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<'en' | 'ett' | null>(null);
  const [misses, setMisses] = useState<DrillNoun[]>([]);

  if (!data) return <p className="muted">Loading…</p>;
  const nouns = drillNouns(data.notes, data.resting);
  if (nouns.length === 0) return <p className="muted">No nouns with en or ett recorded yet.</p>;
  const pool = inLesson(nouns, lesson);

  const start = () => {
    setQueue(shuffled(pool).slice(0, 20));
    setIndex(0);
    setPicked(null);
    setMisses([]);
  };

  if (!queue)
    return (
      <>
        <p className="muted">You see a noun and pick en or ett. There is no rule for most words, so the only way is to meet each one often.</p>
        <LessonSelect items={nouns} value={lesson} onChange={setLesson} />
        <button type="button" className="btn btn-primary btn-big" disabled={pool.length === 0} onClick={start}>
          Start ({Math.min(20, pool.length)} nouns)
        </button>
      </>
    );

  if (index >= queue.length)
    return (
      <div className="card" role="status">
        <h2>
          {queue.length - misses.length} of {queue.length} right
        </h2>
        {misses.length > 0 && (
          <ul>
            {misses.map((n) => (
              <li key={n.noteId} lang="sv">
                <strong>
                  {n.gender} {n.word}
                </strong>
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

  const noun = queue[index];
  const choose = (g: 'en' | 'ett') => {
    if (picked) return;
    setPicked(g);
    void recordTyped(g === noun.gender ? 'correct' : 'wrong', {
      prompt: `en or ett: ${noun.word} (${noun.english})`,
      typed: `${g} ${noun.word}`,
      correct: `${noun.gender} ${noun.word}`,
      reason: `${noun.word} is an ${noun.gender}-word.`,
      tags: [...new Set([...noun.tags, 'en-ett'])],
      cardId: null,
      noteId: noun.noteId,
      source: 'en-ett',
    });
    if (g !== noun.gender) {
      setMisses((m) => [...m, noun]);
      void addMistake({
        at: Date.now(),
        cardId: null,
        noteId: noun.noteId,
        prompt: `en or ett: ${noun.word}`,
        typed: `${g} ${noun.word}`,
        correct: `${noun.gender} ${noun.word}`,
        tags: [...new Set([...noun.tags, 'en-ett'])],
        topic: null,
        manual: false,
      });
    }
  };
  const forms = [`${noun.gender} ${noun.word}`, noun.definite, noun.plural].filter(Boolean).join(', ');

  return (
    <div className="drill">
      <p className="muted small" role="status">
        {index + 1} of {queue.length}
      </p>
      <div className="study-card drill-card">
        <p className="face-type">en or ett?</p>
        <p className="face-main" lang="sv">
          {noun.word}
        </p>
        <p className="face-sub">{noun.english}</p>
        <div className="actions actions-center">
          {(['en', 'ett'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`btn btn-choice ${picked ? (g === noun.gender ? 'is-right' : g === picked ? 'is-wrong' : '') : ''}`}
              aria-pressed={picked === g}
              disabled={picked != null && g !== noun.gender && g !== picked}
              onClick={() => choose(g)}
            >
              {g}
            </button>
          ))}
        </div>
        {picked && (
          <div className="back">
            <p className={picked === noun.gender ? 'verdict verdict-correct' : 'verdict verdict-wrong'} role="status">
              {picked === noun.gender ? 'Correct' : `Not quite. It is ${noun.gender} ${noun.word}.`}
            </p>
            <p className="face-answer" lang="sv">
              {forms}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              autoFocus
              onClick={() => {
                setPicked(null);
                setIndex(index + 1);
              }}
            >
              {index + 1 === queue.length ? 'See results' : 'Next'}
            </button>
          </div>
        )}
      </div>
      <button type="button" className="btn btn-small" onClick={() => setQueue(null)}>
        Stop
      </button>
    </div>
  );
}
