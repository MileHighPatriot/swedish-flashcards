import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { recordTyped } from '../db/repo';
import { useSettings } from '../lib/hooks';
import { neuralEnabled } from '../lib/neural';
import { say, stopSpeaking, useSwedishVoices } from '../lib/speech';
import { STORY_QUESTIONS, askable, gradeStoryAnswer, isRight, storyMisses, storyScore, storyTexts, type StoryAnswer } from '../lib/story';
import { buildLexicon, lookup, tokenize, type Lexicon, type ReadingText } from '../lib/texts';
import { TypedInput, VerdictBox, withReason, type Answer } from '../study/CardView';
import { WordPanel } from './Reader';
import { useNotes, useReasons, useTexts } from './shared';

function Read({ text, lex, onQuiz, onBack }: { text: ReadingText; lex: Lexicon; onQuiz: () => void; onBack: () => void }) {
  const settings = useSettings();
  const voices = useSwedishVoices();
  const [showEnglish, setShowEnglish] = useState(false);
  const [open, setOpen] = useState<{ line: number; token: number } | null>(null);
  useEffect(() => stopSpeaking, []);
  const whole = text.lines.map((l) => l.sv).join(' ');
  const count = Math.min(STORY_QUESTIONS, askable(text).length);

  return (
    <>
      <button type="button" className="back-link btn-link" onClick={onBack}>
        ← All stories
      </button>
      <h2>{text.title}</h2>
      <p className="muted small">1. Read it and tap any word you do not know. 2. Listen. 3. Answer {count} questions in Swedish.</p>
      {voices.length === 0 && !neuralEnabled() && (
        <p className="notice" role="status">
          This device has no Swedish voice, so the listen buttons stay silent. You can still read and answer. To get a voice, see{' '}
          <Link to="/settings">Settings → Swedish audio</Link>.
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn-small" onClick={() => say(whole, settings.ttsRate)}>
          Listen to it all
        </button>
        <button type="button" className="btn btn-small" onClick={() => say(whole, settings.ttsSlowRate)}>
          Listen slowly
        </button>
        <button type="button" className="btn btn-small" onClick={stopSpeaking}>
          Stop
        </button>
        {text.lines.some((l) => l.en) && (
          <button type="button" className="btn btn-small" aria-pressed={showEnglish} onClick={() => setShowEnglish(!showEnglish)}>
            {showEnglish ? 'Hide English' : 'Show English'}
          </button>
        )}
      </div>
      <ol className="reader story-lines">
        {text.lines.map((line, li) => (
          <li key={li} className="reader-line">
            <p lang="sv">
              {tokenize(line.sv).map((t, ti) =>
                t.word ? (
                  <button
                    key={ti}
                    type="button"
                    className={`tok ${lookup(lex, t.text) ? '' : 'tok-new'} ${open?.line === li && open.token === ti ? 'tok-on' : ''}`}
                    onClick={() => setOpen(open?.line === li && open.token === ti ? null : { line: li, token: ti })}
                  >
                    {t.text}
                  </button>
                ) : (
                  <span key={ti}>{t.text}</span>
                ),
              )}
            </p>
            <span className="line-audio">
              <button type="button" className="btn btn-small" aria-label={`Hear line ${li + 1}`} onClick={() => say(line.sv, settings.ttsRate)}>
                ▶ Line {li + 1}
              </button>
              <button type="button" className="btn btn-small" aria-label={`Hear line ${li + 1} slowly`} onClick={() => say(line.sv, settings.ttsSlowRate)}>
                slow
              </button>
            </span>
            {showEnglish && line.en && <p className="reader-en">{line.en}</p>}
            {open?.line === li && <WordPanel key={`${li}:${open.token}`} word={tokenize(line.sv)[open.token].text} line={line} lex={lex} onClose={() => setOpen(null)} />}
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-primary btn-big" onClick={onQuiz}>
        Answer the questions ({count})
      </button>
    </>
  );
}

function Quiz({ text, onDone }: { text: ReadingText; onDone: (answers: StoryAnswer[]) => void }) {
  const reasons = useReasons();
  const questions = useMemo(() => askable(text).slice(0, STORY_QUESTIONS), [text]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [counted, setCounted] = useState(false);
  const [answers, setAnswers] = useState<StoryAnswer[]>([]);
  const nextBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (answer) nextBtn.current?.focus();
  }, [answer]);

  const q = questions[index];
  const hint = q.line != null ? text.lines[q.line - 1] : undefined;
  const wrong = answer?.check?.verdict === 'wrong' && !counted;

  const next = () => {
    if (!answer?.check) return;
    const done = [...answers, { question: q, typed: answer.typed, check: answer.check, counted }];
    setAnswers(done);
    setAnswer(null);
    setCounted(false);
    if (index + 1 === questions.length) onDone(done);
    else setIndex(index + 1);
  };

  return (
    <div className="drill">
      <p className="muted small" role="status">
        Question {index + 1} of {questions.length}
      </p>
      <div className="study-card drill-card">
        <p className="face-type">{text.title} · answer in Swedish</p>
        <p className="face-question" lang="sv">
          {q.question}
        </p>
        {answer ? (
          <div className="back">
            {counted ? (
              <p className="verdict verdict-correct" role="status">
                Counted as right
              </p>
            ) : (
              <VerdictBox answer={answer} />
            )}
            <p className="face-answer" lang="sv">
              {answer.check?.expected}
            </p>
            {q.answers.length > 1 && (
              <p className="face-forms" lang="sv">
                Also correct: {q.answers.filter((a) => a !== answer.check?.expected).join(' · ')}
              </p>
            )}
            {wrong && hint && (
              <p className="face-notes" lang="sv">
                <span className="verdict-label">Line {q.line}</span> {hint.sv}
              </p>
            )}
            <div className="actions actions-center">
              {wrong && answer.typed.trim() && (
                <button type="button" className="btn" onClick={() => setCounted(true)}>
                  Count it as right
                </button>
              )}
              <button ref={nextBtn} type="button" className="btn btn-primary" onClick={next}>
                {index + 1 === questions.length ? 'See the score' : 'Next question'}
              </button>
            </div>
          </div>
        ) : (
          <TypedInput
            key={index}
            label="Type your answer in Swedish"
            onSubmit={(typed) => setAnswer(withReason({ typed, check: gradeStoryAnswer(typed, q) }, reasons ?? null))}
            onSkip={() => setAnswer({ typed: '', check: { ...gradeStoryAnswer('', q), verdict: 'wrong' } })}
          />
        )}
      </div>
    </div>
  );
}

export function Story() {
  const all = useTexts();
  const data = useNotes();
  const reasons = useReasons();
  const [params, setParams] = useSearchParams();
  const [stage, setStage] = useState<'read' | 'quiz' | 'done'>('read');
  const [answers, setAnswers] = useState<StoryAnswer[]>([]);
  const lex = useMemo(() => buildLexicon(data?.notes ?? []), [data]);
  if (!all || !data) return <p className="muted">Loading…</p>;
  const texts = storyTexts(all);
  const text = texts.find((t) => t.id === params.get('text'));

  const finish = (done: StoryAnswer[]) => {
    setAnswers(done);
    setStage('done');
    if (!text) return;
    // Right answers count for anything already on my list; only what I left wrong is added to it.
    for (const a of done) {
      const input = { prompt: `${a.question.question} (${text.title})`, typed: a.typed, correct: a.question.answers.join(' // '), reason: '', tags: text.lesson != null ? [`lesson-${String(text.lesson).padStart(2, '0')}`, 'story'] : ['story'], cardId: null, noteId: null, source: 'story' };
      if (isRight(a)) void recordTyped('correct', input);
    }
    for (const a of storyMisses(done))
      void recordTyped('wrong', {
        prompt: `${a.question.question} (${text.title})`,
        typed: a.typed,
        correct: a.question.answers.join(' // '),
        reason: withReason({ typed: a.typed, check: a.check }, reasons ?? null).reason?.text ?? '',
        tags: text.lesson != null ? [`lesson-${String(text.lesson).padStart(2, '0')}`, 'story'] : ['story'],
        cardId: null,
        noteId: null,
        source: 'story',
      });
  };

  if (!text)
    return (
      <>
        <p className="muted">Read a short text, listen to it, then answer questions about it by typing Swedish.</p>
        {texts.length === 0 && <p className="muted">No stories with questions yet. They arrive with your lessons.</p>}
        <ul className="list">
          {texts.map((t) => (
            <li key={t.id} className="list-item">
              <Link
                className="list-link bar-row"
                to={`/practice/story?text=${encodeURIComponent(t.id)}`}
                onClick={() => {
                  setStage('read');
                  setAnswers([]);
                }}
              >
                <span className="list-title">
                  {t.lesson != null ? `Lesson ${t.lesson}: ` : ''}
                  {t.title}
                </span>
                <span className="list-meta">
                  <span className="pill pill-tag">{Math.min(STORY_QUESTIONS, askable(t).length)} questions</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </>
    );

  if (stage === 'quiz') return <Quiz key={text.id} text={text} onDone={finish} />;

  if (stage === 'done') {
    const score = storyScore(answers);
    const misses = answers.filter((a) => !isRight(a));
    return (
      <div className="card" role="status">
        <h2>
          {score.right} of {score.total} right
        </h2>
        {misses.length > 0 && (
          <>
            <p>These go on My mistakes until you get them right on 3 different days:</p>
            <ul>
              {misses.map((a) => (
                <li key={a.question.question} lang="sv">
                  {a.question.question} <strong>{a.check.expected}</strong>
                  {a.typed.trim() ? ` (you wrote: ${a.typed.trim()})` : ''}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setStage('read')}>
            Read it again
          </button>
          <button type="button" className="btn" onClick={() => setParams({})}>
            Another story
          </button>
          <Link className="btn" to="/practice">
            Done
          </Link>
        </div>
      </div>
    );
  }

  return <Read key={text.id} text={text} lex={lex} onQuiz={() => setStage('quiz')} onBack={() => setParams({})} />;
}
