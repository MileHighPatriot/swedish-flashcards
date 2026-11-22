import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GenderTag, formsSummary } from '../components/GenderTag';
import { CARD_TYPE_LABELS, type Card, type Note } from '../db/types';
import { checkAnswer, checkMeaning, checkVocab, diffAnswer, splitHint, type CheckResult, type Seg } from '../lib/check';
import { makeCloze } from '../lib/cloze';
import { explainError, type Reason, type ReasonContext } from '../lib/reasons';
import { splitAlternatives, splitChunks } from '../lib/parser';
import { shuffled } from '../lib/queue';
import { say, speechSupported } from '../lib/speech';
import type { ID } from '../db/types';
import { topicFor, topicTitle } from '../lib/topics';

/** What I answered before the card was turned over. `check` is null if I just flipped it. */
export interface Answer {
  typed: string;
  check: CheckResult | null;
  /** Why it was wrong, when the mistake is one the app can name (see lib/reasons). */
  reason?: Reason | null;
}

/** Attach the reason for a wrong typed answer. Right and close answers pass through. */
export function withReason(answer: Answer, ctx: ReasonContext | null): Answer {
  if (!ctx || answer.check?.verdict !== 'wrong' || !answer.typed.trim() || answer.reason !== undefined) return answer;
  return { ...answer, reason: explainError(answer.typed, answer.check.expected, ctx) };
}

interface FaceProps {
  card: Card;
  note: Note;
  /** Other notes, used for multiple-choice distractors. */
  pool: Note[];
  revealed: boolean;
  answer: Answer | null;
  onReveal: (answer: Answer | null) => void;
  rate: number;
  slowRate: number;
  /** English → Swedish card answered by typing instead of flipping. */
  typedReverse?: boolean;
}

/**
 * Inside a study session this opens the grammar page in a dialog, so the
 * session is not lost. Without a provider the button is an ordinary link.
 */
export const RuleContext = createContext<((slug: string | null) => void) | null>(null);

/** "Review the rule". Grammar cards always get one; words only when a page fits. */
function RuleLink({ note }: { note: Note }) {
  const open = useContext(RuleContext);
  const slug = topicFor(note);
  if (!slug && note.kind === 'vocab') return null;
  const label = `Review the rule${slug ? `: ${topicTitle(slug) ?? slug}` : ''}`;
  return open ? (
    <button type="button" className="btn btn-small" onClick={() => open(slug)}>
      {label}
    </button>
  ) : (
    <Link className="btn btn-small" to={slug ? `/grammar/${slug}` : '/grammar'}>
      {label}
    </Link>
  );
}

// ---------- small pieces ----------

export function SpeakButton({
  text,
  rate,
  slowRate,
  audioId,
  label = 'Play Swedish audio',
}: {
  text: string;
  rate: number;
  slowRate: number;
  audioId?: ID | null;
  label?: string;
}) {
  if ((!speechSupported() && !audioId) || !text) return null;
  return (
    <span className="speak">
      <button type="button" className="icon-btn" aria-label={label} title={label} onClick={() => say(text, rate, audioId)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm11.5 3a4 4 0 0 0-2-3.5v7a4 4 0 0 0 2-3.5zM13.5 3.8v2.1a6.5 6.5 0 0 1 0 12.2v2.1a8.5 8.5 0 0 0 0-16.4z" />
        </svg>
      </button>
      <button type="button" className="icon-btn icon-btn-text" aria-label={`${label}, slowly`} title="Play slowly" onClick={() => say(text, slowRate, audioId)}>
        slow
      </button>
    </span>
  );
}

function Segs({ segs, badClass }: { segs: Seg[]; badClass: string }) {
  return (
    <>
      {segs.map((s, i) =>
        s.ok ? (
          <span key={i}>{s.text}</span>
        ) : (
          <mark key={i} className={badClass}>
            {s.text}
          </mark>
        ),
      )}
    </>
  );
}

export function VerdictBox({ answer }: { answer: Answer | null }) {
  const c = answer?.check;
  if (!c) return null;
  if (c.verdict === 'correct')
    return (
      <p className="verdict verdict-correct" role="status">
        Correct
      </p>
    );
  if (c.verdict === 'close')
    return (
      <div className="verdict verdict-close" role="status">
        <p>{c.message}</p>
        <p className="verdict-line" lang="sv">
          <span className="verdict-label">You wrote</span> <Segs segs={c.typedDiff} badClass="seg-bad" />
        </p>
        <p className="verdict-line" lang="sv">
          <span className="verdict-label">Correct</span> <Segs segs={c.expectedDiff} badClass="seg-miss" />
        </p>
      </div>
    );
  return (
    <div className="verdict verdict-wrong" role="status">
      <p>Not quite.</p>
      {answer.typed.trim() && (
        <p className="verdict-line" lang="sv">
          <span className="verdict-label">You wrote</span> <Segs segs={c.typedDiff} badClass="seg-bad" />
        </p>
      )}
      <p className="verdict-line" lang="sv">
        <span className="verdict-label">Correct</span> <Segs segs={c.expectedDiff} badClass="seg-miss" />
      </p>
      {answer.reason && (
        <p className="verdict-reason">
          <span className="verdict-label">Why</span> {answer.reason.text}
        </p>
      )}
    </div>
  );
}

const SPECIAL = ['å', 'ä', 'ö'];

/** Text box for Swedish, with å ä ö buttons. Enter checks; "Show answer" gives up. */
export function TypedInput({ label, initial = '', onSubmit, onSkip }: { label: string; initial?: string; onSubmit: (v: string) => void; onSkip: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const insert = (ch: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + ch + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 1, start + 1);
    });
  };
  return (
    <form
      className="typed"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <label className="field">
        <span className="field-label">{label}</span>
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          lang="sv"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
        />
      </label>
      <div className="typed-row">
        <span className="special-keys" role="group" aria-label="Swedish letters">
          {SPECIAL.map((ch) => (
            <button key={ch} type="button" className="key-btn" aria-label={`Insert ${ch}`} onClick={() => insert(ch)}>
              {ch}
            </button>
          ))}
        </span>
        <button type="button" className="btn btn-small" onClick={onSkip}>
          Show answer
        </button>
        <button type="submit" className="btn btn-small btn-primary">
          Check
        </button>
      </div>
    </form>
  );
}

function FlipHint() {
  return <p className="flip-hint muted small">Tap the card or press Space to show the answer</p>;
}

function VocabBack({ note, rate, slowRate, highlight }: { note: Note; rate: number; slowRate: number; highlight?: string }) {
  const forms = formsSummary(note);
  return (
    <div className="back">
      <p className="face-main" lang="sv">
        <GenderTag gender={note.noun?.gender} />
        {note.swedish} <SpeakButton text={note.swedish} rate={rate} slowRate={slowRate} audioId={note.audioId} />
      </p>
      <p className="face-sub">{note.english}</p>
      {forms && (
        <p className="face-forms" lang="sv">
          {forms}
        </p>
      )}
      {note.exampleSv && (
        <p className="face-example">
          <span lang="sv">
            {highlight ? <Highlight text={note.exampleSv} word={highlight} /> : note.exampleSv}{' '}
            <SpeakButton text={note.exampleSv} rate={rate} slowRate={slowRate} label="Play the example" />
          </span>
          {note.exampleEn && <span className="muted">{note.exampleEn}</span>}
        </p>
      )}
      {note.notes && <p className="face-notes">{note.notes}</p>}
      <RuleLink note={note} />
    </div>
  );
}

function Highlight({ text, word }: { text: string; word: string }) {
  const i = text.indexOf(word);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="seg-miss">{word}</mark>
      {text.slice(i + word.length)}
    </>
  );
}

function GrammarBack({ note, children, answerSegs, rate, slowRate }: { note: Note; children?: ReactNode; answerSegs?: Seg[]; rate: number; slowRate: number }) {
  const g = note.grammar!;
  const alts = splitAlternatives(g.answer);
  return (
    <div className="back">
      {children}
      <p className="face-answer" lang="sv">
        {answerSegs ? <Segs segs={answerSegs} badClass="seg-miss" /> : alts[0]}
        {note.kind !== 'rule' && (
          <>
            {' '}
            <SpeakButton text={alts[0]} rate={rate} slowRate={slowRate} label="Play the sentence" />
          </>
        )}
      </p>
      {alts.length > 1 && (
        <p className="face-forms" lang="sv">
          Also correct: {alts.slice(1).join(' · ')}
        </p>
      )}
      {g.explanation && <p className="face-notes">{g.explanation}</p>}
      <RuleLink note={note} />
    </div>
  );
}

// ---------- the nine faces ----------

function Basic({ note, revealed, rate, slowRate }: FaceProps) {
  return (
    <>
      <p className="face-main" lang="sv">
        <GenderTag gender={note.noun?.gender} />
        {note.swedish} <SpeakButton text={note.swedish} rate={rate} slowRate={slowRate} audioId={note.audioId} />
      </p>
      {revealed ? (
        <div className="back">
          <p className="face-answer">{note.english}</p>
          {formsSummary(note) && (
            <p className="face-forms" lang="sv">
              {formsSummary(note)}
            </p>
          )}
          {note.exampleSv && (
            <p className="face-example">
              <span lang="sv">
                {note.exampleSv} <SpeakButton text={note.exampleSv} rate={rate} slowRate={slowRate} label="Play the example" />
              </span>
              {note.exampleEn && <span className="muted">{note.exampleEn}</span>}
            </p>
          )}
          {note.notes && <p className="face-notes">{note.notes}</p>}
          <RuleLink note={note} />
        </div>
      ) : (
        <FlipHint />
      )}
    </>
  );
}

function Reverse({ note, revealed, answer, onReveal, rate, slowRate, typedReverse }: FaceProps) {
  return (
    <>
      <p className="face-main">{note.english}</p>
      <p className="muted small">
        {note.pos !== 'other' ? `${note.pos} · ` : ''}
        {typedReverse ? 'type it in Swedish' : 'say it in Swedish'}
      </p>
      {revealed ? (
        <>
          <VerdictBox answer={answer} />
          <VocabBack note={note} rate={rate} slowRate={slowRate} />
        </>
      ) : typedReverse ? (
        <TypedInput label="Type the Swedish" onSubmit={(typed) => onReveal({ typed, check: checkVocab(typed, note) })} onSkip={() => onReveal(null)} />
      ) : (
        <FlipHint />
      )}
    </>
  );
}

function ClozeFace({ note, revealed, answer, onReveal, rate, slowRate }: FaceProps) {
  const cloze = useMemo(() => makeCloze(note), [note]);
  if (!cloze)
    // No usable example sentence: ask for the word itself.
    return <Typed note={note} revealed={revealed} answer={answer} onReveal={onReveal} rate={rate} slowRate={slowRate} />;
  return (
    <>
      <p className="face-sentence" lang="sv">
        {cloze.before}
        {revealed ? <mark className="seg-miss">{cloze.answer}</mark> : <span className="blank" aria-label="blank" />}
        {cloze.after}
      </p>
      {note.exampleEn && <p className="face-sub">{note.exampleEn}</p>}
      <p className="muted small">
        {note.english}
        {note.pos === 'verb' ? ` (${note.swedish})` : ''}
      </p>
      {revealed ? (
        <>
          <VerdictBox answer={answer} />
          <VocabBack note={note} rate={rate} slowRate={slowRate} highlight={cloze.answer} />
        </>
      ) : (
        <TypedInput
          label="Fill in the blank"
          onSubmit={(typed) => onReveal({ typed, check: checkAnswer(typed, [cloze.answer]) })}
          onSkip={() => onReveal(null)}
        />
      )}
    </>
  );
}

function Typed({ note, revealed, answer, onReveal, rate, slowRate }: Omit<FaceProps, 'card' | 'pool'>) {
  return (
    <>
      <p className="face-main">{note.english}</p>
      {revealed ? (
        <>
          <VerdictBox answer={answer} />
          <VocabBack note={note} rate={rate} slowRate={slowRate} />
        </>
      ) : (
        <TypedInput label="Type the Swedish" onSubmit={(typed) => onReveal({ typed, check: checkVocab(typed, note) })} onSkip={() => onReveal(null)} />
      )}
    </>
  );
}

function Listening({ card, note, pool, revealed, answer, onReveal, rate, slowRate }: FaceProps) {
  const [typing, setTyping] = useState(false);
  const choices = useMemo(() => {
    const others = pool.filter((n) => n.kind === 'vocab' && n.id !== note.id && n.english.toLowerCase() !== note.english.toLowerCase());
    const samePos = others.filter((n) => n.pos === note.pos);
    const picks = shuffled(samePos.length >= 3 ? samePos : others)
      .slice(0, 3)
      .map((n) => n.english);
    return shuffled([note.english, ...new Set(picks)]);
    // New distractors for each showing of the card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, note.id]);

  const pick = (english: string) => {
    const ok = english === note.english;
    onReveal({
      typed: english,
      check: {
        verdict: ok ? 'correct' : 'wrong',
        expected: note.english,
        message: null,
        typedDiff: [{ text: english, ok }],
        expectedDiff: [{ text: note.english, ok: true }],
      },
    });
  };

  // Play as soon as the card appears, and let 1-4 pick an answer.
  useEffect(() => {
    if (revealed) return;
    const t = window.setTimeout(() => say(note.swedish, rate, note.audioId), 250);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < choices.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pick(choices[i]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, card.id]);

  if (revealed)
    return (
      <>
        <VerdictBox answer={answer} />
        <VocabBack note={note} rate={rate} slowRate={slowRate} />
      </>
    );
  return (
    <>
      <div className="listen">
        <button type="button" className="listen-btn" onClick={() => say(note.swedish, rate, note.audioId)} aria-label="Play the word">
          <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
            <path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm11.5 3a4 4 0 0 0-2-3.5v7a4 4 0 0 0 2-3.5zM13.5 3.8v2.1a6.5 6.5 0 0 1 0 12.2v2.1a8.5 8.5 0 0 0 0-16.4z" />
          </svg>
        </button>
        <button type="button" className="btn btn-small" onClick={() => say(note.swedish, slowRate, note.audioId)}>
          Play slowly
        </button>
      </div>
      {!speechSupported() && !note.audioId && <p className="muted small">This browser has no speech. Use “Show answer”.</p>}
      <p className="muted small">What does it mean?</p>
      {typing ? (
        <TypedInput label="Type the meaning in English" onSubmit={(typed) => onReveal({ typed, check: checkMeaning(typed, note.english) })} onSkip={() => onReveal(null)} />
      ) : (
        <>
          <div className="choices">
            {choices.map((c, i) => (
              <button key={c} type="button" className="btn choice" onClick={() => pick(c)}>
                <span className="choice-key" aria-hidden="true">
                  {i + 1}
                </span>
                {c}
              </button>
            ))}
          </div>
          <div className="actions">
            <button type="button" className="btn btn-small" onClick={() => setTyping(true)}>
              Type it instead
            </button>
            <button type="button" className="btn btn-small" onClick={() => onReveal(null)}>
              Show answer
            </button>
          </div>
        </>
      )}
    </>
  );
}

function Rule({ note, revealed, rate, slowRate }: FaceProps) {
  return (
    <>
      <p className="face-question">{note.grammar!.prompt}</p>
      {revealed ? <GrammarBack note={note} rate={rate} slowRate={slowRate} /> : <FlipHint />}
    </>
  );
}

function Fix({ note, revealed, answer, onReveal, rate, slowRate }: FaceProps) {
  const g = note.grammar!;
  const { text, hint } = splitHint(g.prompt);
  const changed = useMemo(() => diffAnswer(text, splitAlternatives(g.answer)[0] ?? ''), [text, g.answer]);
  return (
    <>
      <p className="muted small">Find and fix the mistake</p>
      <p className="face-sentence face-wrong" lang="sv">
        {revealed ? <Segs segs={changed.typed} badClass="seg-bad" /> : text}
      </p>
      {hint && <p className="muted small">({hint})</p>}
      {revealed ? (
        <GrammarBack note={note} answerSegs={changed.expected} rate={rate} slowRate={slowRate}>
          <VerdictBox answer={answer} />
        </GrammarBack>
      ) : (
        <TypedInput
          label="Type the corrected sentence"
          initial={text}
          onSubmit={(typed) => onReveal({ typed, check: checkAnswer(typed, g.answer) })}
          onSkip={() => onReveal(null)}
        />
      )}
    </>
  );
}

function Reorder({ card, note, revealed, answer, onReveal, rate, slowRate }: FaceProps) {
  const g = note.grammar!;
  const { hint } = splitHint(g.prompt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chips = useMemo(() => shuffled(splitChunks(g.prompt)), [card.id, g.prompt]);
  const meaning = hint && <p className="face-question">{hint}</p>;
  const [picked, setPicked] = useState<number[]>([]);
  const [typing, setTyping] = useState(false);
  const built = picked.map((i) => chips[i]).join(' ');

  if (revealed)
    return (
      <>
        <p className="muted small">Put the words in order</p>
        {meaning}
        <GrammarBack note={note} rate={rate} slowRate={slowRate}>
          <VerdictBox answer={answer} />
        </GrammarBack>
      </>
    );
  return (
    <>
      <p className="muted small">Put the words in order{hint ? ' to say' : ''}</p>
      {meaning}
      {typing ? (
        <>
          <p className="face-sentence" lang="sv">
            {chips.join(' / ')}
          </p>
          <TypedInput label="Type the sentence" onSubmit={(typed) => onReveal({ typed, check: checkAnswer(typed, g.answer) })} onSkip={() => onReveal(null)} />
        </>
      ) : (
        <>
          <div className="chip-row chip-answer" aria-label="Your sentence" role="group" lang="sv">
            {picked.length === 0 && <span className="muted small">Tap the words below</span>}
            {picked.map((i, pos) => (
              <button key={i} type="button" className="chip chip-on" aria-label={`Remove ${chips[i]}`} onClick={() => setPicked(picked.filter((_, p) => p !== pos))}>
                {chips[i]}
              </button>
            ))}
          </div>
          <div className="chip-row" aria-label="Words to use" role="group" lang="sv">
            {chips.map((c, i) => (
              <button key={i} type="button" className="chip" disabled={picked.includes(i)} onClick={() => setPicked([...picked, i])}>
                {c}
              </button>
            ))}
          </div>
          <div className="actions">
            <button type="button" className="btn btn-small btn-primary" disabled={picked.length !== chips.length} onClick={() => onReveal({ typed: built, check: checkAnswer(built, g.answer) })}>
              Check
            </button>
            <button type="button" className="btn btn-small" disabled={picked.length === 0} onClick={() => setPicked([])}>
              Reset
            </button>
            <button type="button" className="btn btn-small" onClick={() => setTyping(true)}>
              Type it instead
            </button>
            <button type="button" className="btn btn-small" onClick={() => onReveal(null)}>
              Show answer
            </button>
          </div>
        </>
      )}
    </>
  );
}

function Translate({ note, revealed, answer, onReveal, rate, slowRate }: FaceProps) {
  const g = note.grammar!;
  const { text, hint } = splitHint(g.prompt);
  return (
    <>
      <p className="muted small">Translate into Swedish</p>
      <p className="face-question">{text}</p>
      {hint && <p className="muted small">({hint})</p>}
      {revealed ? (
        <GrammarBack note={note} rate={rate} slowRate={slowRate}>
          <VerdictBox answer={answer} />
        </GrammarBack>
      ) : (
        <TypedInput label="Type it in Swedish" onSubmit={(typed) => onReveal({ typed, check: checkAnswer(typed, g.answer) })} onSkip={() => onReveal(null)} />
      )}
    </>
  );
}

/** Card types that are answered by flipping rather than by typing or picking. */
export function isFlipCard(card: Card, typedReverse = false): boolean {
  return card.type === 'basic' || (card.type === 'reverse' && !typedReverse) || card.type === 'rule';
}

/**
 * Does this English → Swedish card ask for a typed answer? Always when the
 * setting is on. With it off, verbs and anything on my mistakes list still do.
 */
export function reverseIsTyped(note: Pick<Note, 'id' | 'pos' | 'verb'>, typeReverse: boolean, mistakeNotes: ReadonlySet<ID>): boolean {
  return typeReverse || note.pos === 'verb' || !!note.verb || mistakeNotes.has(note.id);
}

/** A typed answer on a card, as "My mistakes" stores it: what was asked and what is right. */
export function mistakeInputFor(card: Card, note: Note): { prompt: string; correct: string; cardId: ID; noteId: ID; tags: string[] } {
  const base = { cardId: card.id, noteId: note.id, tags: note.tags };
  if (note.grammar) {
    const { text, hint } = splitHint(note.grammar.prompt);
    const prompt = note.kind === 'fix' ? `Fix this sentence: ${text}` : note.kind === 'reorder' ? (hint ?? `Put in order: ${text}`) : text;
    return { ...base, prompt, correct: note.grammar.answer };
  }
  if (card.type === 'cloze') {
    const c = makeCloze(note);
    if (c) return { ...base, prompt: `${c.before}____${c.after}${note.exampleEn ? ` (${note.exampleEn})` : ''}`, correct: c.answer };
  }
  return { ...base, prompt: note.english, correct: note.swedish };
}

export function CardView(props: FaceProps) {
  const { card, note } = props;
  // A grammar card whose note lost its content (should not happen) degrades to a message.
  if (note.kind !== 'vocab' && !note.grammar) return <p className="muted">This card has no content. Edit it to fix that.</p>;
  let face: ReactNode;
  switch (card.type) {
    case 'basic':
      face = <Basic {...props} />;
      break;
    case 'reverse':
      face = <Reverse {...props} />;
      break;
    case 'cloze':
      face = <ClozeFace {...props} />;
      break;
    case 'typed':
      face = <Typed {...props} />;
      break;
    case 'listening':
      face = <Listening {...props} />;
      break;
    case 'rule':
      face = <Rule {...props} />;
      break;
    case 'fix':
      face = <Fix {...props} />;
      break;
    case 'reorder':
      face = <Reorder {...props} />;
      break;
    case 'translate':
      face = <Translate {...props} />;
      break;
  }
  return (
    <>
      <p className="face-type">{CARD_TYPE_LABELS[card.type]}</p>
      {face}
    </>
  );
}

/** Plain-text summary of a card, for the mistake log. */
export function describeCard(card: Card, note: Note): { prompt: string; correct: string } {
  if (note.grammar) return { prompt: note.grammar.prompt, correct: note.grammar.answer };
  const sv = `${note.noun?.gender ? `${note.noun.gender} ` : ''}${note.swedish}`;
  switch (card.type) {
    case 'basic':
      return { prompt: sv, correct: note.english };
    case 'listening':
      return { prompt: `(listening) ${note.swedish}`, correct: note.english };
    case 'cloze': {
      const c = makeCloze(note);
      return c ? { prompt: `${c.before}____${c.after}`, correct: c.answer } : { prompt: note.english, correct: sv };
    }
    default:
      return { prompt: note.english, correct: sv };
  }
}

/** What auto-play should say at this moment, if anything. */
export function autoSpeakFor(card: Card, note: Note, revealed: boolean): { text: string; audioId?: ID | null } | null {
  if (note.grammar) {
    if (!revealed || card.type === 'rule') return null;
    return { text: splitAlternatives(note.grammar.answer)[0] ?? '' };
  }
  const word = { text: note.swedish, audioId: note.audioId };
  switch (card.type) {
    case 'basic':
      return revealed ? null : word; // Swedish is on the front
    case 'listening':
      return null; // plays itself
    case 'cloze':
      return revealed ? (makeCloze(note) ? { text: note.exampleSv } : word) : null;
    default:
      return revealed ? word : null; // Swedish is the answer
  }
}
