import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { ensureBuilderCard, getCard, getSettings, listCards, listDecks, listNotes, recordTyped, saveReview, updateSettings } from '../db/repo';
import { BUILDER_DECK, BUILDER_DECK_ID, builderGrade, builderPool, isCurrent, pickSession, type BuilderItem } from '../lib/builder';
import { checkAnswer } from '../lib/check';
import { useSettings } from '../lib/hooks';
import { splitAlternatives } from '../lib/parser';
import { lessonTagOf, planPosition } from '../lib/plan';
import { createScheduler, isLeech } from '../lib/scheduler';
import { SpeakButton, TypedInput, VerdictBox, withReason, type Answer } from '../study/CardView';
import { useReasons, useTexts } from './shared';

/** Rate the sentence's translate card (making the card first if this sentence never had one). */
async function rate(item: BuilderItem, verdict: 'correct' | 'close' | 'wrong', durationMs: number): Promise<string | null> {
  const tags = [...new Set([...(item.lesson != null ? [lessonTagOf(item.lesson)] : []), 'sentence-builder'])];
  const card = item.hasNote
    ? (await listCards()).find((c) => c.noteId === item.noteId && c.type === 'translate')
    : await ensureBuilderCard({ noteId: item.noteId, deckId: BUILDER_DECK_ID, deckName: BUILDER_DECK, en: item.en, sv: item.sv, explanation: item.explanation, lesson: item.lesson, tags });
  const fresh = card && (await getCard(card.id));
  if (!fresh || fresh.suspended) return null;
  const settings = await getSettings();
  const now = Date.now();
  const grade = builderGrade(verdict);
  const { next } = createScheduler({ retention: settings.targetRetention }).rate(fresh, grade, now);
  await saveReview({ card: fresh, next, rating: grade, reviewedAt: now, durationMs, leech: fresh.leech || (grade === 1 && isLeech(next.lapses, settings.leechThreshold)) });
  return fresh.id;
}

export function Builder() {
  const settings = useSettings();
  const texts = useTexts();
  const reasons = useReasons();
  const data = useLiveQuery(async () => {
    const [notes, cards, decks] = await Promise.all([listNotes(), listCards(), listDecks()]);
    return { notes, cards, decks };
  }, []);
  const [queue, setQueue] = useState<BuilderItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [results, setResults] = useState<{ item: BuilderItem; answer: Answer }[]>([]);
  const shownAt = useRef(Date.now());
  const nextBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (answer) nextBtn.current?.focus();
  }, [answer]);

  const pool = useMemo(() => {
    if (!data || !texts) return null;
    const active = new Set(data.cards.filter((c) => !c.suspended).map((c) => c.noteId));
    return builderPool({ notes: data.notes, texts, resting: new Set(data.notes.filter((n) => !active.has(n.id)).map((n) => n.id)) });
  }, [data, texts]);

  if (!data || !pool) return <p className="muted">Loading…</p>;
  const plan = planPosition(data.decks, settings, Date.now());
  const current = pool.filter((i) => isCurrent(i, plan.week, plan.lesson)).length;

  const start = () => {
    const cards = new Map(data.cards.filter((c) => c.type === 'translate').map((c) => [c.noteId, c]));
    setQueue(pickSession(pool, { size: settings.builderSize, currentWeek: plan.week, currentLesson: plan.lesson, cards, now: Date.now() }));
    setIndex(0);
    setAnswer(null);
    setResults([]);
    shownAt.current = Date.now();
  };

  if (!queue)
    return (
      <>
        <p className="muted">You see a sentence in English and type it in Swedish. Every sentence comes from your own cards and texts, and each one is scheduled like a card.</p>
        <label className="field">
          <span className="field-label">Sentences per session</span>
          <select value={settings.builderSize} onChange={(e) => void updateSettings({ builderSize: Number(e.target.value) })}>
            {[5, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n} sentences
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          {current} sentences from this week (week {plan.week}), {pool.length - current} from older lessons. A session takes about 70% from this week.
        </p>
        <button type="button" className="btn btn-primary btn-big" disabled={pool.length === 0} onClick={start}>
          {pool.length ? 'Start building' : 'No sentences yet'}
        </button>
      </>
    );

  if (index >= queue.length) {
    const misses = results.filter((r) => r.answer.check?.verdict === 'wrong');
    return (
      <div className="card" role="status">
        <h2>
          {results.length - misses.length} of {results.length} right
        </h2>
        {misses.length > 0 && (
          <ul>
            {misses.map((r) => (
              <li key={r.item.key}>
                {r.item.en} <strong lang="sv">{splitAlternatives(r.item.sv)[0]}</strong>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={start}>
            Go again
          </button>
          <Link className="btn" to="/mistakes">
            My mistakes
          </Link>
          <Link className="btn" to="/practice">
            Done
          </Link>
        </div>
      </div>
    );
  }

  const item = queue[index];
  const alts = splitAlternatives(item.sv);
  const submit = (typed: string, skipped = false) => {
    const check = checkAnswer(typed, item.sv);
    const a = withReason({ typed, check: skipped ? { ...check, verdict: 'wrong' } : check }, reasons ?? null);
    setAnswer(a);
    setResults((r) => [...r, { item, answer: a }]);
    const verdict = a.check!.verdict;
    void rate(item, verdict, Math.min(Date.now() - shownAt.current, 120_000)).then((cardId) =>
      recordTyped(verdict, { prompt: item.en, typed, correct: item.sv, reason: a.reason?.text ?? item.explanation, tags: item.tags, cardId, noteId: item.noteId, source: 'builder' }),
    );
  };

  return (
    <div className="drill">
      <p className="muted small" role="status">
        {index + 1} of {queue.length}
      </p>
      <div className="study-card drill-card">
        <p className="face-type">Say it in Swedish</p>
        <p className="face-question">{item.en}</p>
        {answer ? (
          <div className="back">
            <VerdictBox answer={answer} />
            <p className="face-answer" lang="sv">
              {answer.check?.expected || alts[0]} <SpeakButton text={answer.check?.expected || alts[0]} rate={settings.ttsRate} slowRate={settings.ttsSlowRate} label="Play the sentence" />
            </p>
            {alts.length > 1 && (
              <p className="face-forms" lang="sv">
                Also correct: {alts.filter((x) => x !== answer.check?.expected).join(' · ')}
              </p>
            )}
            {item.explanation && !answer.reason && <p className="face-notes">{item.explanation}</p>}
            <button
              ref={nextBtn}
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setAnswer(null);
                setIndex(index + 1);
                shownAt.current = Date.now();
              }}
            >
              {index + 1 === queue.length ? 'See results' : 'Next sentence'}
            </button>
          </div>
        ) : (
          <TypedInput key={index} label="Type the Swedish sentence" onSubmit={(t) => submit(t)} onSkip={() => submit('', true)} />
        )}
      </div>
      <button type="button" className="btn btn-small" onClick={() => setQueue(null)}>
        Stop
      </button>
    </div>
  );
}
