import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { NoteForm } from '../components/NoteForm';
import {
  addMistake,
  getNote,
  getSettings,
  listCards,
  listCheckpoints,
  listDecks,
  listMistakeItems,
  listMistakes,
  listNotes,
  listReviews,
  listTags,
  recordTyped,
  removeMistake,
  removeReview,
  saveCramReview,
  saveReview,
  setSuspended,
  undoReview,
} from '../db/repo';
import {
  CATEGORY_LABELS,
  CardState,
  DECK_CATEGORIES,
  type Card,
  type DeckCategory,
  type Grade,
  type ID,
  type Mistake,
  type MistakeItem,
  type Note,
  type ReviewLog,
  type Settings,
} from '../db/types';
import { suggestedGrade } from '../lib/check';
import { useNow, useSettings } from '../lib/hooks';
import { advance, buildQueue, cardsInScope, dropCurrent, remaining, startSession, type QueueOptions, type SessionState } from '../lib/queue';
import { GRADES, GRADE_LABELS, createScheduler, isLeech, studyDayEnd, studyDayStart } from '../lib/scheduler';
import { say, stopSpeaking } from '../lib/speech';
import { topicFor, topicTitle } from '../lib/topics';
import { computeWeakSpots, weakSpotCardIds } from '../lib/weakspots';
import { GrammarPageView } from './Grammar';
import { buildReasonContext } from '../lib/reasons';
import { dueItems, isActive } from '../lib/mistakeItems';
import { planPosition, weekSessionTags } from '../lib/plan';
import { CardView, RuleContext, autoSpeakFor, describeCard, isFlipCard, mistakeInputFor, reverseIsTyped, withReason, type Answer } from '../study/CardView';
import { MistakeRound, type RoundSummary } from '../study/MistakeRound';

// ---------- the session ----------

interface UndoEntry {
  session: SessionState;
  card: Card;
  saved: Promise<ReviewLog>;
  mistake: Promise<Mistake> | null;
}

interface Loaded {
  cards: Map<ID, Card>;
  notes: Map<ID, Note>;
  pool: Note[];
  settings: Settings;
  /** Notes with something on my mistakes list: their English → Swedish card is always typed. */
  mistakeNotes: Set<ID>;
}

const SWIPE_PX = 90;

function Session({ opts, onExit }: { opts: QueueOptions; onExit: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  // My mistakes come first in every scheduled session; null once they are done (or there were none).
  const [round, setRound] = useState<MistakeItem[] | null>(null);
  const [roundResult, setRoundResult] = useState<RoundSummary | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [leech, setLeech] = useState<{ cardId: ID; noteId: ID; label: string; lapses: number } | null>(null);
  const [editing, setEditing] = useState<ID | null>(null);
  const [rule, setRule] = useState<string | null>(null);
  const ruleDialog = useRef<HTMLDialogElement>(null);
  const [drag, setDrag] = useState(0);
  const [, bump] = useState(0);
  const shownAt = useRef(Date.now());
  const startedAt = useRef(Date.now());
  const total = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const cardEl = useRef<HTMLDivElement>(null);
  const rateEl = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number; id: number } | null>(null);

  // Hide the tab bar while studying, and stop any speech on the way out.
  useEffect(() => {
    document.body.classList.add('in-session');
    return () => {
      document.body.classList.remove('in-session');
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const settings = await getSettings();
      const now = Date.now();
      const [cards, notes, decks, logs, items] = await Promise.all([listCards(), listNotes(), listDecks(), listReviews(studyDayStart(now, settings.dayStartHour)), listMistakeItems()]);
      if (!live) return;
      const due = opts.mode === 'normal' ? dueItems(items, now, settings.dayStartHour) : [];
      setRound(due.length ? due : null);
      const queue = buildQueue({ cards, notes, decks, logsToday: logs, settings, now }, opts);
      const cardMap = new Map(cards.map((c) => [c.id, c]));
      total.current = queue.learning.length + queue.main.length;
      setData({ cards: cardMap, notes: new Map(notes.map((n) => [n.id, n])), pool: notes, settings, mistakeNotes: new Set(items.filter(isActive).flatMap((i) => (i.noteId ? [i.noteId] : []))) });
      setSession(startSession(queue, opts.mode, (id) => cardMap.get(id)?.due ?? 0, now));
      shownAt.current = startedAt.current = Date.now();
    })();
    return () => {
      live = false;
    };
  }, [opts]);

  const scheduler = useMemo(() => (data ? createScheduler({ retention: data.settings.targetRetention }) : null), [data]);
  const card = session?.current && data ? data.cards.get(session.current) : undefined;
  const note = card && data ? data.notes.get(card.noteId) : undefined;
  const cram = opts.mode === 'cram';
  const typedReverse = !!card && !!note && !!data && card.type === 'reverse' && reverseIsTyped(note, data.settings.typeReverse, data.mistakeNotes);

  // Auto-play: say the Swedish when it appears (front of a Swedish card, or the answer).
  const autoPlay = data?.settings.autoPlayAudio ?? false;
  const ttsRate = data?.settings.ttsRate ?? 1;
  const cardKey = card ? `${card.id}:${session?.done}:${undo.length}` : '';
  useEffect(() => {
    if (!autoPlay || !card || !note) return;
    const line = autoSpeakFor(card, note, revealed);
    if (!line?.text) return;
    const t = window.setTimeout(() => say(line.text, ttsRate, line.audioId), 150);
    return () => window.clearTimeout(t);
    // Only when a card appears or is turned over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, cardKey, revealed]);

  const preview = useMemo(
    () => (card && scheduler && revealed && !cram ? scheduler.preview(card, Date.now()) : null),
    [card, scheduler, revealed, cram],
  );

  const nextCard = useCallback(() => {
    setRevealed(false);
    setAnswer(null);
    setDrag(0);
    shownAt.current = Date.now();
    stopSpeaking();
    requestAnimationFrame(() => cardEl.current?.focus({ preventScroll: true }));
  }, []);

  const reasons = useMemo(() => (data ? buildReasonContext(data.pool) : null), [data]);
  const reveal = useCallback(
    (a: Answer | null) => {
      const checked = a && withReason(a, reasons);
      setAnswer(checked);
      setRevealed(true);
      requestAnimationFrame(() => rateEl.current?.focus({ preventScroll: true }));
      // Every typed answer feeds "My mistakes": a wrong one is kept until it is really fixed.
      if (checked?.check && card && note && card.type !== 'listening')
        void recordTyped(checked.check.verdict, {
          ...mistakeInputFor(card, note),
          typed: checked.typed,
          reason: checked.reason?.text ?? note.grammar?.explanation ?? '',
          source: 'study',
        });
    },
    [reasons, card, note],
  );

  const rate = useCallback(
    (grade: Grade) => {
      if (!data || !session || !card || !note || !scheduler || !revealed) return;
      const now = Date.now();
      const durationMs = Math.min(now - shownAt.current, 120_000);
      const dueOf = (id: ID) => data.cards.get(id)?.due ?? 0;
      let comesBack: boolean;
      let saved: Promise<ReviewLog>;

      if (cram) {
        comesBack = grade === 1;
        saved = saveCramReview(card, grade, now, durationMs);
      } else {
        const { next } = scheduler.rate(card, grade, now);
        const nowLeech = card.leech || (grade === 1 && isLeech(next.lapses, data.settings.leechThreshold));
        data.cards.set(card.id, { ...card, ...next, leech: nowLeech });
        comesBack = (next.state === CardState.Learning || next.state === CardState.Relearning) && next.due < studyDayEnd(now, data.settings.dayStartHour);
        saved = saveReview({ card, next, rating: grade, reviewedAt: now, durationMs, leech: nowLeech });
        if (nowLeech && !card.leech) setLeech({ cardId: card.id, noteId: note.id, label: note.grammar?.prompt ?? note.swedish, lapses: next.lapses });
      }
      saved.catch((e: unknown) => console.error('Could not save review', e));

      let mistake: Promise<Mistake> | null = null;
      if (grade === 1) {
        const d = describeCard(card, note);
        mistake = addMistake({ at: now, cardId: card.id, noteId: note.id, prompt: d.prompt, typed: answer?.typed ?? '', correct: d.correct, tags: note.tags, topic: topicFor(note), manual: false });
      }

      setUndo((u) => [...u.slice(-49), { session, card, saved, mistake }]);
      setSession(advance(session, comesBack, grade === 1, dueOf, now));
      nextCard();
    },
    [data, session, card, note, scheduler, revealed, cram, answer, nextCard],
  );

  const undoLast = useCallback(async () => {
    const entry = undo[undo.length - 1];
    if (!entry || !data) return;
    setUndo((u) => u.slice(0, -1));
    data.cards.set(entry.card.id, entry.card);
    setSession(entry.session);
    setLeech(null);
    nextCard();
    const log = await entry.saved;
    if (entry.session.mode === 'cram') await removeReview(log.id);
    else await undoReview(entry.card, log.id);
    if (entry.mistake) await removeMistake((await entry.mistake).id);
  }, [undo, data, nextCard]);

  const suspend = useCallback(
    async (cardId: ID) => {
      if (!data || !session) return;
      await setSuspended(cardId, true);
      const c = data.cards.get(cardId);
      if (c) data.cards.set(cardId, { ...c, suspended: true });
      const dueOf = (id: ID) => data.cards.get(id)?.due ?? 0;
      if (session.current === cardId) {
        setSession(dropCurrent(session, dueOf, Date.now()));
        nextCard();
      } else {
        setSession({ ...session, learning: session.learning.filter((x) => x !== cardId), main: session.main.filter((x) => x !== cardId) });
      }
      setLeech(null);
    },
    [data, session, nextCard],
  );

  // The edit dialog.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (editing && !d.open) d.showModal();
    if (!editing && d.open) d.close();
  }, [editing]);

  // "Review the rule" opens the notes page over the session instead of leaving it.
  const openRule = useCallback((slug: string | null) => setRule(slug ?? ''), []);
  useEffect(() => {
    const d = ruleDialog.current;
    if (!d) return;
    if (rule !== null && !d.open) d.showModal();
    if (rule === null && d.open) d.close();
  }, [rule]);

  const editDone = async (what: 'saved' | 'deleted' | 'cancelled') => {
    const noteId = editing;
    setEditing(null);
    if (!noteId || !data || !session) return;
    if (what === 'deleted') {
      const gone = new Set([...data.cards.values()].filter((c) => c.noteId === noteId).map((c) => c.id));
      const dueOf = (id: ID) => data.cards.get(id)?.due ?? 0;
      const pruned = { ...session, learning: session.learning.filter((x) => !gone.has(x)), main: session.main.filter((x) => !gone.has(x)) };
      if (session.current && gone.has(session.current)) {
        setSession(dropCurrent(pruned, dueOf, Date.now()));
        nextCard();
      } else setSession(pruned);
      setLeech(null);
    } else if (what === 'saved') {
      const fresh = await getNote(noteId);
      if (fresh) data.notes.set(noteId, fresh);
      bump((n) => n + 1);
    }
  };

  // Keyboard: Space flips (then rates Good), 1-4 rate, Z undoes, E edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || rule !== null || round || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'enter') {
        if (target.closest('button, a, summary')) return; // let the focused control act
        e.preventDefault();
        if (!revealed) {
          if (card && isFlipCard(card, typedReverse)) reveal(null);
          else (cardEl.current?.querySelector('input') as HTMLInputElement | null)?.focus();
        } else rate(3);
      } else if (revealed && k >= '1' && k <= '4') {
        e.preventDefault();
        rate(cram ? (k === '1' ? 1 : 3) : (Number(k) as Grade));
      } else if (k === 'z') {
        e.preventDefault();
        void undoLast();
      } else if (k === 'e' && card) {
        e.preventDefault();
        setEditing(card.noteId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, rule, round, revealed, card, typedReverse, cram, reveal, rate, undoLast]);

  if (!data || !session) return <p className="muted">Loading…</p>;

  if (round)
    return (
      <section className="session">
        <h1 className="sr-only">My mistakes</h1>
        <header className="session-head">
          <button type="button" className="btn btn-small" onClick={onExit} aria-label="End session">
            ✕
          </button>
          <div className="session-progress">First, the things you are fixing</div>
          <div className="session-tools">
            <button type="button" className="btn btn-small" onClick={() => setRound(null)}>
              Skip to the cards
            </button>
          </div>
        </header>
        <MistakeRound
          items={round}
          notes={data.notes}
          reasons={reasons}
          rate={data.settings.ttsRate}
          slowRate={data.settings.ttsSlowRate}
          onDone={(summary) => {
            setRoundResult(summary);
            setRound(null);
            shownAt.current = Date.now();
          }}
        />
      </section>
    );

  if (!card || !note) {
    const minutes = Math.max(1, Math.round((Date.now() - startedAt.current) / 60000));
    const fixed = roundResult ? roundResult.right + roundResult.wrong : 0;
    return (
      <section className="done-screen">
        <h1>{session.done > 0 || fixed > 0 ? 'Bra jobbat!' : 'Nothing to study here'}</h1>
        {fixed > 0 && (
          <p>
            My mistakes: {roundResult!.right} right, {roundResult!.wrong} to see again. <Link to="/mistakes">See the list</Link>
          </p>
        )}
        {session.done > 0 ? (
          <p>
            {session.done} review{session.done === 1 ? '' : 's'} in about {minutes} min
            {session.again > 0 ? `, ${session.again} to see again` : ''}.
          </p>
        ) : fixed > 0 ? (
          <p className="muted">No cards are due in this selection right now.</p>
        ) : (
          <p className="muted">No cards are due in this selection right now. Cram mode shows them anyway.</p>
        )}
        <div className="actions">
          <Link className="btn btn-primary" to="/">
            Back to home
          </Link>
          <button type="button" className="btn" onClick={onExit}>
            Study something else
          </button>
          {undo.length > 0 && (
            <button type="button" className="btn" onClick={() => void undoLast()}>
              Undo last answer
            </button>
          )}
        </div>
      </section>
    );
  }

  const suggested = answer?.check ? suggestedGrade(answer.check.verdict) : null;
  const left = remaining(session);
  const flip = isFlipCard(card, typedReverse);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!revealed || (e.target as HTMLElement).closest('button, a, input')) return;
    pointer.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(e.clientY - p.y)) setDrag(dx);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointer.current;
    pointer.current = null;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    setDrag(0);
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 2 * Math.abs(dy)) rate(dx < 0 ? 1 : 3);
  };

  return (
    <section className="session">
      <h1 className="sr-only">Study session</h1>
      <header className="session-head">
        <button type="button" className="btn btn-small" onClick={onExit} aria-label="End session">
          ✕
        </button>
        <div className="session-progress" role="status" aria-live="off">
          {cram && <span className="pill pill-warn">Cram</span>} <strong>{left}</strong> left · {session.done} done
        </div>
        <div className="session-tools">
          <button type="button" className="btn btn-small" disabled={undo.length === 0} onClick={() => void undoLast()} title="Undo (Z)">
            Undo
          </button>
          <button type="button" className="btn btn-small" onClick={() => setEditing(note.id)} title="Edit (E)">
            Edit
          </button>
          <button type="button" className="btn btn-small" onClick={() => void suspend(card.id)} title="Take this card out of rotation">
            Suspend
          </button>
        </div>
      </header>
      <div className="progress session-bar" aria-hidden="true">
        <div className="progress-bar" style={{ width: `${Math.min(100, (session.done / Math.max(1, session.done + left)) * 100)}%` }} />
      </div>

      {leech && (
        <div className="card card-warn leech" role="status">
          <p>
            <strong>“{leech.label}” keeps slipping</strong> (forgotten {leech.lapses} times). Rewriting it, or adding an example, usually helps.
          </p>
          <div className="actions">
            <button type="button" className="btn btn-small" onClick={() => setEditing(leech.noteId)}>
              Edit it
            </button>
            <button type="button" className="btn btn-small" onClick={() => void suspend(leech.cardId)}>
              Suspend it
            </button>
            <button type="button" className="btn btn-small" onClick={() => setLeech(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div
        ref={cardEl}
        key={`${card.id}:${session.done}:${undo.length}`}
        className={`study-card ${revealed ? 'is-revealed' : ''} ${flip && !revealed ? 'is-tappable' : ''}`}
        tabIndex={-1}
        aria-label={revealed ? 'Card, answer shown' : 'Card'}
        style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 40}deg)`, transition: 'none' } : undefined}
        data-swipe={drag <= -SWIPE_PX ? 'again' : drag >= SWIPE_PX ? 'good' : undefined}
        onClick={(e) => {
          if (!revealed && flip && !(e.target as HTMLElement).closest('button, a, input')) reveal(null);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          pointer.current = null;
          setDrag(0);
        }}
      >
        {card.leech && <span className="pill pill-warn leech-flag">Leech</span>}
        <RuleContext.Provider value={openRule}>
        <CardView
          card={card}
          note={note}
          pool={data.pool}
          revealed={revealed}
          answer={answer}
          onReveal={reveal}
          rate={data.settings.ttsRate}
          slowRate={data.settings.ttsSlowRate}
          typedReverse={typedReverse}
        />
        </RuleContext.Provider>
      </div>

      <div ref={rateEl} className="rate-bar" tabIndex={-1} role="group" aria-label="Rate your answer">
        {!revealed ? (
          flip ? (
            <button type="button" className="btn btn-primary rate-show" onClick={() => reveal(null)}>
              Show answer
            </button>
          ) : (
            <p className="muted small rate-wait">Answer above, then rate yourself.</p>
          )
        ) : cram ? (
          <>
            <button type="button" className="rate-btn rate-1" onClick={() => rate(1)}>
              <span className="rate-label">Again</span>
              <span className="rate-int">comes back</span>
              <kbd aria-hidden="true">1</kbd>
            </button>
            <button type="button" className={`rate-btn rate-3 ${suggested !== 1 ? 'is-suggested' : ''}`} onClick={() => rate(3)}>
              <span className="rate-label">Got it</span>
              <span className="rate-int">next card</span>
              <kbd aria-hidden="true">Space</kbd>
            </button>
          </>
        ) : (
          GRADES.map((g) => (
            <button
              key={g}
              type="button"
              className={`rate-btn rate-${g} ${suggested === g ? 'is-suggested' : ''}`}
              onClick={() => rate(g)}
              aria-label={`${GRADE_LABELS[g]}, next review in ${preview?.[g].interval ?? ''}`}
            >
              <span className="rate-label">{GRADE_LABELS[g]}</span>
              <span className="rate-int">{preview?.[g].interval}</span>
              <kbd aria-hidden="true">{g}</kbd>
            </button>
          ))
        )}
      </div>
      {revealed && <p className="muted small swipe-hint">Swipe left for Again, right for Good. Z undoes.</p>}

      <dialog ref={ruleDialog} className="edit-dialog" aria-label="Grammar notes" onClose={() => setRule(null)}>
        {rule !== null && (
          <>
            <div className="actions dialog-head">
              <button type="button" className="btn btn-primary" autoFocus onClick={() => setRule(null)}>
                Back to the card
              </button>
            </div>
            {rule ? (
              <GrammarPageView slug={rule} embedded />
            ) : (
              <p className="muted">This card is not linked to a notes page yet. Add a tag such as verb-second, -te, questions or spelling to link it.</p>
            )}
          </>
        )}
      </dialog>

      <dialog ref={dialog} className="edit-dialog" aria-label="Edit card" onClose={() => setEditing(null)}>
        {editing && (
          <>
            <h2>Edit card</h2>
            <NoteForm key={editing} noteId={editing} onDone={(w) => void editDone(w)} />
          </>
        )}
      </dialog>
    </section>
  );
}

// ---------- choosing what to study ----------

type ScopeValue = 'all' | `cat:${DeckCategory}` | `deck:${string}`;

export function Study() {
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const now = useNow();
  const [run, setRun] = useState<QueueOptions | null>(null);
  const [shuffle, setShuffle] = useState(false);
  const autoStarted = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  const scopeValue: ScopeValue = params.get('deck') ? `deck:${params.get('deck')}` : params.get('cat') ? (`cat:${params.get('cat')}` as ScopeValue) : 'all';
  const tag = params.get('tag') ?? '';
  const scope = useMemo(
    () => ({
      deckId: scopeValue.startsWith('deck:') ? scopeValue.slice(5) : undefined,
      category: scopeValue.startsWith('cat:') ? (scopeValue.slice(4) as DeckCategory) : undefined,
      tag: tag || undefined,
    }),
    [scopeValue, tag],
  );

  const dayStart = studyDayStart(now, settings.dayStartHour);
  const data = useLiveQuery(async () => {
    const [cards, notes, decks, logsToday, tags, items] = await Promise.all([listCards(), listNotes(), listDecks(), listReviews(dayStart), listTags(), listMistakeItems()]);
    return { cards, notes, decks, logsToday, tags, items };
  }, [dayStart]);

  const counts = useMemo(() => {
    if (!data) return null;
    const q = buildQueue({ ...data, settings, now }, { ...scope, mode: 'normal', shuffle: false });
    const inScope = cardsInScope(data, scope);
    const more = buildQueue({ ...data, settings, now }, { ...scope, mode: 'normal', shuffle: false, extraNew: 10 }).counts.new - q.counts.new;
    return { ...q.counts, cram: inScope.length, more };
  }, [data, settings, now, scope]);

  // My mistakes left for today open every scheduled session, so they count as something to study.
  const fixes = data ? dueItems(data.items, now, settings.dayStartHour).length : 0;

  // "Start studying" on the home screen goes straight in.
  useEffect(() => {
    if (autoStarted.current || !counts || params.get('start') !== '1') return;
    autoStarted.current = true;
    if (counts.learning + counts.review + counts.new + fixes > 0) setRun({ mode: 'normal', shuffle: false });
  }, [counts, params, fixes]);

  // "This week's lesson" on the home screen: my mistakes, then the cards of every lesson in my current plan week.
  const week = params.get('week') === '1';
  useEffect(() => {
    if (autoStarted.current || !data || !week) return;
    autoStarted.current = true;
    void listCheckpoints().then((checkpoints) => {
      const { week: w } = planPosition(data.decks, settings, Date.now());
      setRun({ mode: 'normal', shuffle: false, tags: weekSessionTags(w, checkpoints) });
    });
  }, [data, week, settings]);

  // A set of tags from a link, e.g. the lessons of a block to repeat: /study?tags=lesson-06,lesson-07.
  const tagSet = params.get('tags');
  useEffect(() => {
    if (autoStarted.current || !data || !tagSet) return;
    autoStarted.current = true;
    setRun({ mode: 'normal', shuffle: false, tags: tagSet.split(',').filter(Boolean) });
  }, [data, tagSet]);

  // Links from the Grammar tab: /study?weak=1 and /study?topic=verb-second.
  const weak = params.get('weak') === '1';
  const topic = params.get('topic');
  useEffect(() => {
    if (autoStarted.current || !data || (!weak && !topic)) return;
    autoStarted.current = true;
    void (async () => {
      let ids: ID[];
      if (topic) {
        const noteById = new Map(data.notes.map((n) => [n.id, n]));
        ids = cardsInScope(data, {})
          .filter((c) => topicFor(noteById.get(c.noteId)!) === topic)
          .map((c) => c.id);
      } else {
        const [reviews, mistakes] = await Promise.all([listReviews(0), listMistakes()]);
        ids = weakSpotCardIds(computeWeakSpots({ reviews, mistakes, notes: data.notes, cards: data.cards, now: Date.now() }), data.cards, data.notes);
      }
      if (ids.length) setRun({ mode: 'cram', shuffle: false, cardIds: ids });
      else setNotice(topic ? `No cards are linked to “${topicTitle(topic) ?? topic}” yet.` : 'No weak spots yet. Keep studying and they will show up.');
    })();
  }, [data, weak, topic]);

  if (run) return <Session opts={run} onExit={() => setRun(null)} />;

  const setScope = (v: string) => {
    const next: Record<string, string> = {};
    if (v.startsWith('deck:')) next.deck = v.slice(5);
    if (v.startsWith('cat:')) next.cat = v.slice(4);
    if (tag) next.tag = tag;
    setParams(next, { replace: true });
  };
  const setTag = (t: string) => {
    const next = Object.fromEntries([...params.entries()].filter(([k]) => k !== 'tag' && k !== 'start'));
    if (t) next.tag = t;
    setParams(next, { replace: true });
  };

  const due = counts ? counts.learning + counts.review : 0;
  const deck = data?.decks.find((d) => d.id === scope.deckId);

  return (
    <section>
      <header className="page-head">
        <h1>Study</h1>
      </header>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <div className="filters">
        <label className="field">
          <span className="field-label">What to study</span>
          <select value={scopeValue} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Everything</option>
            {DECK_CATEGORIES.map((c) => (
              <option key={c} value={`cat:${c}`}>
                All {CATEGORY_LABELS[c].toLowerCase()}
              </option>
            ))}
            {DECK_CATEGORIES.map((cat) => (
              <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
                {data?.decks
                  .filter((d) => (d.category ?? 'vocab') === cat)
                  .map((d) => (
                    <option key={d.id} value={`deck:${d.id}`}>
                      {d.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Tag</span>
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Any tag</option>
            {data?.tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="check">
        <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
        Shuffle the order
      </label>

      {deck?.locked && (
        <p className="notice">
          This deck is locked, so its cards are not in rotation. <Link to={`/words?deck=${deck.id}`}>Unlock it in Browse</Link>.
        </p>
      )}

      <div className="stat-row">
        <div className="stat">
          <span className="stat-num">{counts ? due : '–'}</span>
          <span className="stat-label">Due</span>
        </div>
        <div className="stat">
          <span className="stat-num">{counts?.new ?? '–'}</span>
          <span className="stat-label">New</span>
        </div>
        <div className="stat">
          <span className="stat-num">{counts?.cram ?? '–'}</span>
          <span className="stat-label">In this set</span>
        </div>
      </div>

      <button type="button" className="btn btn-primary btn-big" disabled={!counts || due + counts.new + fixes === 0} onClick={() => setRun({ ...scope, mode: 'normal', shuffle })}>
        {counts && due + counts.new + fixes === 0 ? 'All done for today' : 'Start studying'}
      </button>
      {fixes > 0 && (
        <p className="muted small">
          The session starts with {fixes} of <Link to="/mistakes">your mistakes</Link>, then the cards.
        </p>
      )}

      <div className="actions">
        <button type="button" className="btn" disabled={!counts || counts.cram === 0} onClick={() => setRun({ ...scope, mode: 'cram', shuffle })}>
          Cram all {counts?.cram ?? ''} (ignores the schedule)
        </button>
        {counts && counts.more > 0 && (
          <button type="button" className="btn" onClick={() => setRun({ ...scope, mode: 'normal', shuffle, extraNew: counts.more })}>
            Learn {counts.more} more new card{counts.more === 1 ? '' : 's'}
          </button>
        )}
        <Link className="btn" to={scope.deckId ? `/words?deck=${scope.deckId}` : '/words'}>
          Browse these cards
        </Link>
      </div>
      <p className="muted small">
        Cram is for running through a lesson before you write it out. It does not change when cards come back. Keys: Space to flip, 1 to 4 to rate, Z
        to undo, E to edit.
      </p>
    </section>
  );
}
