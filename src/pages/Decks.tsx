import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { listCards, listDecks, listReviews } from '../db/repo';
import type { Card, Deck, ReviewLog, Settings } from '../db/types';
import { deckRowCounts, groupDecks } from '../lib/decks';
import { useNow, useSettings } from '../lib/hooks';
import { currentLesson } from '../lib/plan';
import { studyDayStart } from '../lib/scheduler';
import { StudyNav } from '../study/StudyNav';

interface RowData {
  cards: Card[];
  logs: ReviewLog[];
  settings: Settings;
  now: number;
}

/**
 * One deck. "N new" is this deck's own count of cards never studied, not what
 * today's cap would hand out (that read "10 new" on every row).
 */
export function DeckRow({ deck, data }: { deck: Deck; data: RowData }) {
  const c = deckRowCounts(deck.id, data.cards, data.logs, data.settings, data.now);
  return (
    <li className="list-item">
      <Link to={deck.locked ? `/words?deck=${deck.id}` : `/study?deck=${deck.id}`} className="list-link">
        <span className="list-title">{deck.name}</span>
        <span className="list-meta">
          {deck.locked ? (
            <span className="pill pill-locked">Locked</span>
          ) : (
            <>
              <span className="pill pill-due">{c.due} due</span>
              <span className="pill pill-new">{c.unstarted} new</span>
            </>
          )}
          <span className="pill">{c.total} cards</span>
        </span>
      </Link>
    </li>
  );
}

/** Every deck, grouped by plan week and lesson, with the current lesson on top. */
export function Decks() {
  const settings = useSettings();
  const now = useNow();
  const dayStart = studyDayStart(now, settings.dayStartHour);
  const [query, setQuery] = useState('');
  const data = useLiveQuery(async () => {
    const [decks, cards, logs] = await Promise.all([listDecks(), listCards(), listReviews(dayStart)]);
    return { decks, cards, logs };
  }, [dayStart]);
  if (!data) return <p className="muted">Loading…</p>;

  const lesson = currentLesson(data.decks, settings);
  const { pinned, groups } = groupDecks(data.decks, lesson, query);
  const row: RowData = { cards: data.cards, logs: data.logs, settings, now };
  const found = pinned.length + groups.reduce((n, g) => n + g.decks.length, 0);

  return (
    <section>
      <StudyNav />
      <header className="page-head decks-head">
        <h1>Decks</h1>
        <Link className="btn btn-primary add-btn" to="/add" aria-label="Add cards">
          <span aria-hidden="true">+</span>
        </Link>
      </header>
      <label className="field">
        <span className="field-label">Search decks</span>
        <input type="search" value={query} placeholder="Lesson 6, phrases, mistakes…" onChange={(e) => setQuery(e.target.value)} />
      </label>
      <p className="muted small" role="status">
        {found} deck{found === 1 ? '' : 's'}
        {query.trim() ? ` matching “${query.trim()}”` : ''}
      </p>

      {pinned.length > 0 && (
        <>
          <h2>Current lesson: Lesson {lesson}</h2>
          <ul className="list">
            {pinned.map((d) => (
              <DeckRow key={d.id} deck={d} data={row} />
            ))}
          </ul>
        </>
      )}

      {groups.map((g) => (
        // Older weeks start collapsed; a search opens everything it finds.
        <details key={`${g.key}:${query.trim() ? 'q' : ''}`} className="deck-group" open={g.current || !!query.trim()}>
          <summary>
            <span className="deck-group-title">{g.title}</span>
            <span className="pill">{g.decks.length}</span>
          </summary>
          <ul className="list">
            {g.decks.map((d) => (
              <DeckRow key={d.id} deck={d} data={row} />
            ))}
          </ul>
        </details>
      ))}
      {found === 0 && <p className="muted">{data.decks.length === 0 ? 'No decks yet. Add your first lesson to get going.' : 'No deck matches that search.'}</p>}
    </section>
  );
}
