import { useState } from 'react';
import { CARD_TYPE_LABELS, CATEGORY_LABELS, DECK_CATEGORIES, type DeckCategory, type Draft } from '../db/types';
import type { PlanGroup, PlanRow, RowAction } from '../lib/importer';
import { GenderTag } from './GenderTag';
import { NoteEditor } from './NoteEditor';

function formsOf(d: Draft): string {
  const parts: string[] = [];
  if (d.noun) parts.push(d.noun.definite, d.noun.plural);
  if (d.verb) parts.push(d.verb.present, d.verb.past, d.verb.supine);
  if (d.adjective) parts.push(d.adjective.neuter, d.adjective.plural);
  return parts.filter(Boolean).join(' · ');
}

function Row({ row, onChange }: { row: PlanRow; onChange: (r: PlanRow) => void }) {
  const [editing, setEditing] = useState(false);
  const d = row.draft;
  const title = d.kind === 'vocab' ? d.swedish : (d.grammar?.prompt ?? '');
  return (
    <li className={`list-item preview-row ${row.action === 'skip' ? 'is-skipped' : ''}`}>
      <div className="preview-main">
        <div className="preview-text">
          {d.kind === 'vocab' ? (
            <>
              <span className="word-sv" lang="sv">
                <GenderTag gender={d.noun?.gender} />
                {d.swedish}
              </span>{' '}
              <span className="word-en">{d.english}</span>
              {formsOf(d) && (
                <div className="word-forms" lang="sv">
                  {formsOf(d)}
                </div>
              )}
              {d.exampleSv && (
                <div className="word-example">
                  <span lang="sv">{d.exampleSv}</span> <span className="muted">{d.exampleEn}</span>
                </div>
              )}
              {d.notes && <div className="word-forms">{d.notes}</div>}
            </>
          ) : (
            <>
              <span className="word-sv">{d.grammar?.prompt}</span>
              <div className="word-example" lang="sv">
                {d.grammar?.answer}
              </div>
              {d.grammar?.explanation && <div className="word-forms">{d.grammar.explanation}</div>}
            </>
          )}
          <div className="word-tags">
            <span className="pill">{d.kind === 'vocab' ? d.pos : CARD_TYPE_LABELS[d.kind]}</span>
            {d.tags.map((t) => (
              <span key={t} className="pill pill-tag">
                #{t}
              </span>
            ))}
            {row.duplicate && (
              <span className="pill pill-warn">
                {row.duplicate.noteId == null
                  ? 'Repeated in this paste'
                  : row.duplicate.sameDeck
                    ? 'Already in this deck'
                    : `Already in “${row.duplicate.deckName}”`}
              </span>
            )}
          </div>
        </div>
        <div className="preview-actions">
          <select
            aria-label={`What to do with ${title}`}
            value={row.action}
            onChange={(e) => onChange({ ...row, action: e.target.value as RowAction })}
          >
            <option value="add">{row.duplicate ? 'Add anyway' : 'Add'}</option>
            {row.duplicate?.noteId && <option value="merge">Merge</option>}
            <option value="skip">Skip</option>
          </select>
          <button type="button" className="btn btn-small" aria-expanded={editing} onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>
      {editing && <NoteEditor draft={d} onChange={(draft) => onChange({ ...row, draft })} />}
    </li>
  );
}

export function ImportPreview({ plan, onChange }: { plan: PlanGroup[]; onChange: (p: PlanGroup[]) => void }) {
  const setGroup = (i: number, g: PlanGroup) => onChange(plan.map((x, j) => (j === i ? g : x)));
  return (
    <>
      {plan.map((g, i) => {
        const dups = g.rows.filter((r) => r.duplicate?.noteId);
        const setAll = (action: RowAction) =>
          setGroup(i, { ...g, rows: g.rows.map((r) => (r.duplicate?.noteId ? { ...r, action } : r)) });
        return (
          <section key={i} className="card preview-group" aria-label={`Deck ${g.deck.name}`}>
            <div className="field-grid">
              <label className="field">
                <span className="field-label">Goes into deck</span>
                <input type="text" value={g.deck.name} onChange={(e) => setGroup(i, { ...g, deck: { ...g.deck, name: e.target.value } })} />
              </label>
              <label className="field">
                <span className="field-label">Section</span>
                <select
                  value={g.deck.category}
                  onChange={(e) => setGroup(i, { ...g, deck: { ...g.deck, category: e.target.value as DeckCategory } })}
                >
                  {DECK_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted small">
              {g.rows.filter((r) => r.action === 'add').length} to add, {g.rows.filter((r) => r.action === 'merge').length} to merge,{' '}
              {g.rows.filter((r) => r.action === 'skip').length} to skip. A deck with this name is updated if it exists, otherwise created.
            </p>
            {dups.length > 0 && (
              <div className="actions">
                <span className="small">{dups.length} already exist:</span>
                <button type="button" className="btn btn-small" onClick={() => setAll('merge')}>
                  Merge all
                </button>
                <button type="button" className="btn btn-small" onClick={() => setAll('skip')}>
                  Skip all
                </button>
              </div>
            )}
            <ul className="list">
              {g.rows.map((r, j) => (
                <Row key={r.key} row={r} onChange={(row) => setGroup(i, { ...g, rows: g.rows.map((x, k) => (k === j ? row : x)) })} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
