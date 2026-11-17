import { useMemo, useState } from 'react';
import { useSettings } from '../lib/hooks';
import { shuffled } from '../lib/queue';
import { say } from '../lib/speech';
import { ALL, LessonSelect, Recorder, inLesson, useSentences } from './shared';

export function Speak() {
  const settings = useSettings();
  const sentences = useSentences();
  const [lesson, setLesson] = useState(ALL);
  const [round, setRound] = useState(0);
  const [index, setIndex] = useState(0);
  // A fresh order each time the lesson changes or I ask for a reshuffle.
  const queue = useMemo(() => shuffled(inLesson(sentences ?? [], lesson)), [sentences?.length, lesson, round]);

  if (!sentences) return <p className="muted">Loading…</p>;
  if (sentences.length === 0) return <p className="muted">No sentences yet. They come from the example sentences and phrases on your cards.</p>;
  const item = queue[Math.min(index, queue.length - 1)];

  return (
    <>
      <p className="muted">Listen, say it, record yourself, then play the two back to back. The gap you hear is what to fix.</p>
      <LessonSelect
        items={sentences}
        value={lesson}
        onChange={(l) => {
          setLesson(l);
          setIndex(0);
        }}
      />
      {item && (
        <div className="drill">
          <p className="muted small" role="status">
            {Math.min(index, queue.length - 1) + 1} of {queue.length}
          </p>
          <div className="study-card drill-card">
            <p className="face-main face-sentence" lang="sv">
              {item.sv}
            </p>
            {item.en && <p className="face-sub">{item.en}</p>}
            <div className="actions actions-center">
              <button type="button" className="btn btn-primary" onClick={() => say(item.sv, settings.ttsRate)}>
                Listen
              </button>
              <button type="button" className="btn" onClick={() => say(item.sv, settings.ttsSlowRate)}>
                Slowly
              </button>
            </div>
            <Recorder key={item.sv} />
          </div>
          <div className="actions">
            <button type="button" className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              Back
            </button>
            {index + 1 < queue.length ? (
              <button type="button" className="btn btn-primary" onClick={() => setIndex(index + 1)}>
                Next sentence
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setRound(round + 1);
                  setIndex(0);
                }}
              >
                Shuffle and start over
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
