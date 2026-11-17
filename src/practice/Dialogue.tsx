import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSettings } from '../lib/hooks';
import { say, stopSpeaking } from '../lib/speech';
import { isDialogue, speakersOf, type ReadingText } from '../lib/texts';
import { SpeakButton } from '../study/CardView';
import { Recorder, useTexts } from './shared';

function Play({ text, me, listenFirst, onExit }: { text: ReadingText; me: string; listenFirst: boolean; onExit: () => void }) {
  const settings = useSettings();
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [index, shown]);
  useEffect(() => stopSpeaking, []);

  const line = text.lines[index];
  const mine = line?.speaker === me;
  const go = (i: number) => {
    setIndex(i);
    setShown(false);
    const l = text.lines[i];
    if (l && l.speaker !== me) say(l.sv, settings.ttsRate);
  };

  return (
    <div className="dialogue">
      <ol className="bubbles" aria-label="The conversation so far">
        {text.lines.slice(0, index).map((l, i) => (
          <li key={i} className={l.speaker === me ? 'bubble bubble-me' : 'bubble'}>
            <span className="bubble-who">{l.speaker}</span>
            <span lang="sv">{l.sv}</span>
            {l.en && <span className="bubble-en">{l.en}</span>}
          </li>
        ))}
      </ol>

      {!line ? (
        <div className="card" role="status">
          <h2>Bra jobbat!</h2>
          <p>You played {me} all the way through.</p>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => go(0)}>
              Again
            </button>
            <button type="button" className="btn" onClick={onExit}>
              Switch role or dialogue
            </button>
            <Link className="btn" to="/practice">
              Done
            </Link>
          </div>
        </div>
      ) : mine ? (
        <div className="card turn" role="group" aria-label="Your turn">
          <p className="face-type">Your turn. Say it in Swedish</p>
          <p className="turn-en">{line.en || '(say your line)'}</p>
          <Recorder key={index} />
          {shown ? (
            <>
              <p className="face-answer" lang="sv">
                {line.sv}
              </p>
              <SpeakButton text={line.sv} rate={settings.ttsRate} slowRate={settings.ttsSlowRate} label="Hear the line" />
              <button type="button" className="btn btn-primary" onClick={() => go(index + 1)}>
                Next
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setShown(true);
                say(line.sv, settings.ttsRate);
              }}
            >
              Show and hear the line
            </button>
          )}
        </div>
      ) : (
        <div className="card turn" role="group" aria-label={`${line.speaker} speaks`}>
          <p className="face-type">{line.speaker} says</p>
          {listenFirst && !shown ? (
            <button type="button" className="btn" onClick={() => setShown(true)}>
              Show what she said
            </button>
          ) : (
            <>
              <p className="face-answer" lang="sv">
                {line.sv}
              </p>
              {line.en && <p className="face-sub">{line.en}</p>}
            </>
          )}
          <SpeakButton text={line.sv} rate={settings.ttsRate} slowRate={settings.ttsSlowRate} label="Hear it again" />
          <button type="button" className="btn btn-primary" onClick={() => go(index + 1)}>
            {text.lines[index + 1]?.speaker === me ? 'My turn' : 'Next'}
          </button>
        </div>
      )}
      <div ref={end} />
      {line && (
        <button type="button" className="btn btn-small" onClick={onExit}>
          Stop
        </button>
      )}
    </div>
  );
}

export function Dialogue() {
  const texts = useTexts();
  const settings = useSettings();
  const [params] = useSearchParams();
  const [id, setId] = useState<string | null>(params.get('text'));
  const [role, setRole] = useState<string | null>(null);
  const [listenFirst, setListenFirst] = useState(false);
  const [playing, setPlaying] = useState(false);

  if (!texts) return <p className="muted">Loading…</p>;
  const dialogues = texts.filter(isDialogue);
  if (dialogues.length === 0) return <p className="muted">No dialogues yet.</p>;
  // Newest lesson first.
  const sorted = [...dialogues].sort((a, b) => (b.lesson ?? 0) - (a.lesson ?? 0));
  const text = sorted.find((t) => t.id === id) ?? sorted[0];
  const speakers = speakersOf(text);
  const me = role && speakers.includes(role) ? role : speakers.includes('Du') ? 'Du' : speakers[speakers.length - 1];

  if (playing) return <Play key={`${text.id}:${me}`} text={text} me={me} listenFirst={listenFirst} onExit={() => setPlaying(false)} />;

  return (
    <>
      <p className="muted">The app speaks the other person's lines and waits while you say yours. Then it shows your line so you can check.</p>
      <label className="field">
        <span className="field-label">Dialogue</span>
        <select value={text.id} onChange={(e) => setId(e.target.value)}>
          {sorted.map((t) => (
            <option key={t.id} value={t.id}>
              {t.lesson != null ? `Lesson ${t.lesson}: ` : ''}
              {t.title}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="checks">
        <legend className="field-label">I play</legend>
        {speakers.map((s) => (
          <label key={s} className="check">
            <input type="radio" name="role" checked={me === s} onChange={() => setRole(s)} />
            {s} ({text.lines.filter((l) => l.speaker === s).length} lines)
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={listenFirst} onChange={(e) => setListenFirst(e.target.checked)} />
        Hide the other person's lines until I ask (listening practice)
      </label>
      <button
        type="button"
        className="btn btn-primary btn-big"
        onClick={() => {
          setPlaying(true);
          const first = text.lines[0];
          if (first && first.speaker !== me) say(first.sv, settings.ttsRate);
        }}
      >
        Start the conversation
      </button>
    </>
  );
}
