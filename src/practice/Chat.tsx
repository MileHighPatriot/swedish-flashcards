import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { SwedishKeys } from '../components/SwedishKeys';
import {
  formatCost,
  loadChatKey,
  parseReview,
  replyCost,
  requestReply,
  requestReview,
  reviewHasSections,
  type ChatLevel,
  type ChatTurn,
  type ReviewSections,
} from '../lib/chat';
import { useSettings } from '../lib/hooks';
import { say } from '../lib/speech';
import { SpeakButton } from '../study/CardView';

const LEVELS: { id: ChatLevel; label: string }[] = [
  { id: 'starting', label: 'Just starting' },
  { id: 'comfortable', label: 'A bit further' },
];

function priceOf(kind: 'chat' | 'review', usage: { inputTokens: number; outputTokens: number } | null): number | null {
  if (!usage) return null;
  return replyCost(kind, usage.inputTokens, usage.outputTokens);
}

export function Chat() {
  const settings = useSettings();
  const key = useLiveQuery(loadChatKey, []);
  const box = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState<ChatLevel>('starting');
  const [topic, setTopic] = useState('');
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [review, setReview] = useState<ReviewSections | null>(null);
  const [spent, setSpent] = useState(0);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [lastReview, setLastReview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'talk' | 'review' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addSpend = (usd: number | null, setLabel: (label: string | null) => void) => {
    if (usd == null) {
      setLabel(null);
      return;
    }
    setSpent((n) => n + usd);
    setLabel(formatCost(usd));
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !key || busy) return;
    const next = [...turns, { role: 'user' as const, content: text }];
    setTurns(next);
    setDraft('');
    setReview(null);
    setBusy('talk');
    setError(null);
    try {
      const result = await requestReply(key, level, topic, next);
      setTurns([...next, { role: 'assistant', content: result.text }]);
      addSpend(priceOf('chat', result.usage), setLastReply);
      say(result.text, settings.ttsRate);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  };

  const end = async () => {
    if (!key || busy || turns.length === 0) return;
    setBusy('review');
    setError(null);
    try {
      const result = await requestReview(key, turns);
      setReview(parseReview(result.text));
      addSpend(priceOf('review', result.usage), setLastReview);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setTurns([]);
    setReview(null);
    setDraft('');
    setSpent(0);
    setLastReply(null);
    setLastReview(null);
    setError(null);
  };

  if (key === undefined) return <p className="muted">Loading…</p>;

  if (!key) {
    return (
      <div className="card">
        <p>Free conversation needs an xAI API key. It stays on this device.</p>
        <Link className="btn btn-primary" to="/settings">
          Add the key in Settings
        </Link>
      </div>
    );
  }

  return (
    <div ref={box}>
      <p className="muted">Talk about anything. The partner answers in Swedish. When you stop, one review tells you what to fix.</p>
      <div className="field-grid">
        <label className="field">
          <span className="field-label">How far along</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as ChatLevel)} disabled={busy != null}>
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Topic, if you want one</span>
          <input type="text" value={topic} placeholder="At the store" onChange={(e) => setTopic(e.target.value)} disabled={busy != null} />
        </label>
      </div>

      {turns.length > 0 && (
        <ol className="bubbles" aria-label="The conversation">
          {turns.map((t, i) => (
            <li key={i} className={t.role === 'user' ? 'bubble bubble-me' : 'bubble'}>
              <span className="bubble-who">{t.role === 'user' ? 'You' : 'Partner'}</span>
              <span lang={t.role === 'user' ? undefined : 'sv'}>{t.content}</span>
              {t.role === 'assistant' && (
                <SpeakButton text={t.content} rate={settings.ttsRate} slowRate={settings.ttsSlowRate} label="Play the reply" />
              )}
            </li>
          ))}
        </ol>
      )}

      {lastReply && (
        <p className="muted small" role="status">
          Last reply: {lastReply}. This conversation so far: {formatCost(spent)}.
        </p>
      )}

      <SwedishKeys container={box} />
      <label className="field">
        <span className="field-label">Your line</span>
        <textarea
          rows={3}
          lang="sv"
          autoCapitalize="sentences"
          spellCheck={false}
          value={draft}
          placeholder="Hej!"
          disabled={busy != null}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={busy != null || !draft.trim()} onClick={() => void send()}>
          {busy === 'talk' ? 'Sending…' : 'Send'}
        </button>
        <button type="button" className="btn" disabled={busy != null || turns.length === 0} onClick={() => void end()}>
          {busy === 'review' ? 'Reviewing…' : 'End and review'}
        </button>
        {turns.length > 0 && (
          <button type="button" className="btn" disabled={busy != null} onClick={reset}>
            New conversation
          </button>
        )}
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}

      {review && (
        <div className="card">
          <h2>Review</h2>
          {reviewHasSections(review) ? (
            <>
              <h3>What you did wrong</h3>
              <p className="review-body">{review.wrong || 'Nothing listed.'}</p>
              <h3>What to say instead</h3>
              <p className="review-body">{review.instead || 'Nothing listed.'}</p>
              <h3>Tips</h3>
              <p className="review-body">{review.tips || 'Nothing listed.'}</p>
            </>
          ) : (
            <p className="review-body">{review.raw}</p>
          )}
          {lastReview && <p className="muted small">This review: {lastReview}.</p>}
        </div>
      )}
    </div>
  );
}
