import { useMemo, useRef, useState } from 'react';
import { SwedishKeys } from '../components/SwedishKeys';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { GenderTag, formsSummary } from '../components/GenderTag';
import { NoteForm } from '../components/NoteForm';
import { deleteDeck, listCards, listDecks, listNotes, listTags, unlockDeck, updateDeck } from '../db/repo';
import { CARD_TYPE_LABELS, CATEGORY_LABELS, DECK_CATEGORIES, type Deck, type DeckCategory, type Note } from '../db/types';
import { dateStamp, downloadBackup, downloadFile, notesToCSV } from '../lib/backup';

function matches(n: Note, q: string): boolean {
  const hay = [n.swedish, n.english, n.grammar?.prompt, n.grammar?.answer, ...n.tags];
  return hay.some((s) => s?.toLowerCase().includes(q));
}

function DeckPanel({ deck, notes, onGone }: { deck: Deck; notes: Note[]; onGone: () => void }) {
  const [name, setName] = useState(deck.name);
  const [open, setOpen] = useState(false);

  const remove = async () => {
    if (!window.confirm(`Delete the deck “${deck.name}” and its ${notes.length} cards, including their review history? This cannot be undone.`))
      return;
    if (window.confirm('Download a full backup first? (Recommended.) Press Cancel to delete without one.')) await downloadBackup();
    await deleteDeck(deck.id);
    onGone();
  };

  return (
    <div className="card">
      <div className="actions">
        {deck.locked && (
          <button type="button" className="btn btn-primary" onClick={() => void unlockDeck(deck.id)}>
            Unlock this deck
          </button>
        )}
        <button type="button" className="btn btn-small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Close deck options' : 'Deck options'}
        </button>
      </div>
      {deck.locked && <p className="muted small">Locked: these cards stay out of your reviews until you unlock the deck.</p>}
      {open && (
        <>
          <div className="field-grid">
            <label className="field">
              <span className="field-label">Deck name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && name !== deck.name && void updateDeck(deck.id, { name: name.trim() })}
              />
            </label>
            <label className="field">
              <span className="field-label">Section</span>
              <select value={deck.category ?? 'vocab'} onChange={(e) => void updateDeck(deck.id, { category: e.target.value as DeckCategory })}>
                {DECK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={() =>
                void listDecks().then((all) =>
                  downloadFile(`svenska-kort-${deck.name.replace(/[^\p{L}\p{N}]+/gu, '-')}-${dateStamp()}.csv`, '﻿' + notesToCSV(notes, all), 'text/csv'),
                )
              }
            >
              Export CSV
            </button>
            <button type="button" className="btn btn-small btn-danger" onClick={() => void remove()}>
              Delete deck
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Words() {
  const [params, setParams] = useSearchParams();
  const deckId = params.get('deck') ?? '';
  const [query, setQuery] = useState('');
  const tag = params.get('tag') ?? '';
  const filtersRef = useRef<HTMLDivElement>(null);
  const tags = useLiveQuery(listTags, []);
  const setFilter = (next: { deck?: string; tag?: string }) => {
    const p: Record<string, string> = {};
    const d = next.deck ?? deckId;
    const t = next.tag ?? tag;
    if (d) p.deck = d;
    if (t) p.tag = t;
    setParams(p);
  };

  const decks = useLiveQuery(listDecks, []);
  const notes = useLiveQuery(() => listNotes(deckId || undefined), [deckId]);
  const cards = useLiveQuery(() => listCards(deckId || undefined), [deckId]);
  const deck = decks?.find((d) => d.id === deckId);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const t = tag.toLowerCase();
    return (notes ?? []).filter((n) => (!t || n.tags.some((x) => x.toLowerCase() === t)) && (!q || matches(n, q)));
  }, [notes, query, tag]);

  const flags = useMemo(() => {
    const m = new Map<string, { suspended: boolean; leech: boolean }>();
    for (const c of cards ?? []) {
      const f = m.get(c.noteId) ?? { suspended: true, leech: false };
      m.set(c.noteId, { suspended: f.suspended && c.suspended, leech: f.leech || c.leech });
    }
    return m;
  }, [cards]);

  return (
    <section>
      <header className="page-head">
        <h1>Browse</h1>
        <p className="muted" role="status">
          {notes ? `${shown.length} of ${notes.length} cards` : 'Loading…'}
        </p>
      </header>

      <div className="filters" ref={filtersRef}>
        <label className="field">
          <span className="field-label">Deck</span>
          <select value={deckId} onChange={(e) => setFilter({ deck: e.target.value })}>
            <option value="">All decks</option>
            {DECK_CATEGORIES.map((cat) => (
              <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
                {decks
                  ?.filter((d) => (d.category ?? 'vocab') === cat)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Tag</span>
          <select value={tag} onChange={(e) => setFilter({ tag: e.target.value })}>
            <option value="">Any tag</option>
            {tags?.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Search</span>
          <input
            lang="sv"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Swedish, English or tag"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <SwedishKeys container={filtersRef} />
        </label>
      </div>

      {(deckId || tag) && shown.length > 0 && (
        <div className="actions">
          <Link className="btn btn-small btn-primary" to={`/study?${new URLSearchParams({ ...(deckId ? { deck: deckId } : {}), ...(tag ? { tag } : {}) }).toString()}`}>
            Study {tag ? `#${tag}` : 'this deck'}
          </Link>
          {tag && (
            <button type="button" className="btn btn-small" onClick={() => setParams(deckId ? { deck: deckId } : {})}>
              Clear tag
            </button>
          )}
        </div>
      )}

      {deck && notes && <DeckPanel key={deck.id} deck={deck} notes={notes} onGone={() => setParams(tag ? { tag } : {})} />}

      <ul className="list">
        {shown.map((n) => (
          <li key={n.id} className="list-item word">
            {n.grammar ? (
              <>
                <div className="word-main">
                  <span className="word-sv">{n.grammar.prompt}</span>
                </div>
                <div className="word-example" lang="sv">
                  {n.grammar.answer}
                </div>
              </>
            ) : (
              <>
                <div className="word-main">
                  <span className="word-sv" lang="sv">
                    <GenderTag gender={n.noun?.gender} />
                    {n.swedish}
                  </span>
                  <span className="word-en">{n.english}</span>
                </div>
                {formsSummary(n) && (
                  <div className="word-forms" lang="sv">
                    {formsSummary(n)}
                  </div>
                )}
                {n.exampleSv && (
                  <div className="word-example">
                    <span lang="sv">{n.exampleSv}</span>
                    {n.exampleEn && <span className="muted"> {n.exampleEn}</span>}
                  </div>
                )}
              </>
            )}
            <div className="word-foot">
              <div className="word-tags">
                <span className="pill">{n.kind === 'vocab' ? n.pos : CARD_TYPE_LABELS[n.kind]}</span>
                {flags.get(n.id)?.leech && <span className="pill pill-warn">Leech</span>}
                {flags.get(n.id)?.suspended && <span className="pill pill-locked">Suspended</span>}
                {n.tags.map((t) => (
                  <button key={t} type="button" className="pill pill-tag pill-btn" onClick={() => setFilter({ tag: t })} aria-label={`Show cards tagged ${t}`}>
                    #{t}
                  </button>
                ))}
              </div>
              <Link className="btn btn-small" to={`/edit/${n.id}`} aria-label={`Edit ${n.grammar?.prompt ?? n.swedish}`}>
                Edit
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {notes && shown.length === 0 && <p className="muted">Nothing matches.</p>}
    </section>
  );
}

export function EditNote() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <section>
      <header className="page-head">
        <h1>Edit card</h1>
      </header>
      {id && <NoteForm key={id} noteId={id} onDone={() => navigate(-1)} />}
    </section>
  );
}
