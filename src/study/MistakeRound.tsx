import { useEffect, useRef, useState } from 'react';
import { recordCorrect, recordWrong } from '../db/repo';
import type { ID, MistakeItem, Note } from '../db/types';
import { checkAnswer, checkVocab, canon } from '../lib/check';
import { RETIRE_DAYS } from '../lib/mistakeItems';
import { splitAlternatives } from '../lib/parser';
import type { ReasonContext } from '../lib/reasons';
import { SpeakButton, TypedInput, VerdictBox, withReason, type Answer } from './CardView';

export interface RoundSummary {
  right: number;
  wrong: number;
}

interface Props {
  items: MistakeItem[];
  notes?: Map<ID, Note>;
  reasons: ReasonContext | null;
  rate: number;
  slowRate: number;
  onDone: (summary: RoundSummary) => void;
}

/**
 * My mistakes, one at a time, as typed cards. A right answer counts for today;
 * a wrong one sends the item back to zero days and it comes round once more
 * before the round ends. None of this touches the card's own schedule.
 */
export function MistakeRound({ items, notes, reasons, rate, slowRate, onDone }: Props) {
  const [queue, setQueue] = useState(items);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const summary = useRef<RoundSummary>({ right: 0, wrong: 0 });
  const retried = useRef(new Set<ID>());
  const nextBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (answer) nextBtn.current?.focus();
  }, [answer]);

  const item = queue[index];
  useEffect(() => {
    if (!item) onDone(summary.current);
    // Only when the round runs out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  if (!item) return null;

  const first = splitAlternatives(item.correct)[0] ?? item.correct;
  const note = item.noteId ? notes?.get(item.noteId) : undefined;
  // A single word of mine: "en hund" is as good as "hund".
  const asWord = note && note.kind === 'vocab' && canon(note.swedish) === canon(first) ? note : null;

  const submit = (typed: string, skipped = false) => {
    const check = asWord ? checkVocab(typed, asWord) : checkAnswer(typed, item.correct);
    const a = withReason({ typed, check: skipped ? { ...check, verdict: 'wrong' } : check }, reasons);
    setAnswer(a);
    if (a.check?.verdict === 'correct') {
      summary.current.right++;
      void recordCorrect(item.id).then((next) => setDays(next ? next.correctDays.length : null));
    } else if (a.check?.verdict === 'wrong') {
      summary.current.wrong++;
      setDays(0);
      if (typed.trim())
        void recordWrong({ prompt: item.prompt, typed, correct: item.correct, reason: a.reason?.text ?? item.reason, tags: item.tags, cardId: item.cardId, noteId: item.noteId, source: item.source });
      // Once more before the round ends.
      if (!retried.current.has(item.id)) {
        retried.current.add(item.id);
        setQueue((q) => [...q, item]);
      }
    } else setDays(item.correctDays.length);
  };

  const wrong = answer?.check?.verdict === 'wrong';
  return (
    <div className="drill">
      <p className="muted small" role="status">
        My mistakes: {index + 1} of {queue.length}
      </p>
      <div className="study-card drill-card">
        <p className="face-type">My mistakes · type the correct Swedish</p>
        <p className="face-question">{item.prompt}</p>
        {item.source === 'dictation' && <SpeakButton text={first} rate={rate} slowRate={slowRate} label="Play the sentence" />}
        {answer ? (
          <div className="back">
            <VerdictBox answer={answer} />
            <p className="face-answer" lang="sv">
              {first} <SpeakButton text={first} rate={rate} slowRate={slowRate} label="Play the answer" />
            </p>
            {wrong && !answer.reason && item.reason && (
              <p className="face-notes">
                <span className="verdict-label">Why</span> {item.reason}
              </p>
            )}
            {item.typed && (
              <p className="muted small" lang="sv">
                Earlier you wrote: {item.typed}
              </p>
            )}
            {days != null && (
              <p className="small">
                {days >= RETIRE_DAYS ? 'Fixed: right on 3 different days. It leaves the list.' : wrong ? 'Back to 0 of 3 days.' : `Right on ${days} of ${RETIRE_DAYS} days.`}
              </p>
            )}
            <button
              ref={nextBtn}
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setAnswer(null);
                setDays(null);
                setIndex(index + 1);
              }}
            >
              {index + 1 === queue.length ? 'Done' : 'Next'}
            </button>
          </div>
        ) : (
          <TypedInput key={index} label="Type the correct Swedish" onSubmit={(t) => submit(t)} onSkip={() => submit('', true)} />
        )}
      </div>
    </div>
  );
}
