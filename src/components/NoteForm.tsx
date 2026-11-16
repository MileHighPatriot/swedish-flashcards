import { useEffect, useRef, useState } from 'react';
import { playMedia } from '../lib/speech';
import { useLiveQuery } from 'dexie-react-hooks';
import { createDeck, createNote, deleteNote, emptyNoteInput, findDeckByName, getNote, listCards, listDecks, removeMedia, saveMedia, setNoteSuspended, updateNote } from '../db/repo';
import {
  CATEGORY_LABELS,
  DECK_CATEGORIES,
  VOCAB_CARD_TYPES,
  emptyDraft,
  type DeckCategory,
  type Draft,
  type ID,
  type VocabCardType,
} from '../db/types';
import { useSettings } from '../lib/hooks';
import { CardTypePicker, Field, NoteEditor, draftProblem } from './NoteEditor';

const NEW_DECK = '__new__';

interface Props {
  /** Edit this note; leave out to create a new one. */
  noteId?: ID;
  /** Called after saving, deleting or cancelling. */
  onDone?: (what: 'saved' | 'deleted' | 'cancelled') => void;
  /** Deck preselected for a new card. */
  defaultDeckId?: ID;
}

/** Create or edit one card: deck, content, and which sibling cards exist. */
export function NoteForm({ noteId, onDone, defaultDeckId }: Props) {
  const settings = useSettings();
  const decks = useLiveQuery(listDecks, []);
  const [draft, setDraft] = useState<Draft | null>(noteId ? null : emptyDraft());
  const [deckId, setDeckId] = useState<string>(defaultDeckId ?? '');
  const [newDeck, setNewDeck] = useState('');
  const [newCategory, setNewCategory] = useState<DeckCategory>('vocab');
  const [types, setTypes] = useState<VocabCardType[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [audioId, setAudioId] = useState<ID | null>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const siblings = useLiveQuery(async () => (noteId ? (await listCards()).filter((c) => c.noteId === noteId) : []), [noteId]);
  const allSuspended = !!siblings?.length && siblings.every((c) => c.suspended);

  useEffect(() => {
    if (!noteId) return;
    let live = true;
    void getNote(noteId).then((n) => {
      if (!live || !n) return;
      setDraft(n);
      setDeckId(n.deckId);
      setAudioId(n.audioId);
      setTypes(n.cardTypes.filter((t): t is VocabCardType => (VOCAB_CARD_TYPES as string[]).includes(t)));
    });
    return () => {
      live = false;
    };
  }, [noteId]);

  if (!draft || !decks) return <p className="muted">Loading…</p>;
  const cardTypes = types ?? settings.defaultCardTypes;
  const chosenDeck =
    deckId || (decks.find((d) => !d.locked && (d.category ?? 'vocab') === 'vocab') ?? decks.find((d) => !d.locked))?.id || NEW_DECK;

  const save = async () => {
    const problem = draftProblem(draft);
    if (problem) return setMessage(problem);
    let target = chosenDeck;
    if (target === NEW_DECK) {
      if (!newDeck.trim()) return setMessage('Give the new deck a name.');
      target = ((await findDeckByName(newDeck)) ?? (await createDeck({ name: newDeck, category: newCategory }))).id;
      setDeckId(target);
      setNewDeck('');
    }
    const content = {
      kind: draft.kind,
      grammar: draft.grammar,
      swedish: draft.swedish.trim(),
      english: draft.english.trim(),
      pos: draft.pos,
      exampleSv: draft.exampleSv.trim(),
      exampleEn: draft.exampleEn.trim(),
      notes: draft.notes,
      tags: draft.tags,
      noun: draft.pos === 'noun' ? draft.noun : null,
      verb: draft.pos === 'verb' ? draft.verb : null,
      adjective: draft.pos === 'adjective' ? draft.adjective : null,
      deckId: target,
      cardTypes,
      audioId: draft.kind === 'vocab' ? audioId : null,
    };
    if (noteId) {
      await updateNote(noteId, content);
      onDone?.('saved');
    } else {
      await createNote({ ...emptyNoteInput(target), ...content });
      setMessage(`Added “${draft.kind === 'vocab' ? draft.swedish : draft.grammar?.prompt}”.`);
      setDraft({ ...emptyDraft(draft.kind), pos: draft.pos, tags: draft.tags });
      setFormKey((k) => k + 1);
      setAudioId(null);
      onDone?.('saved');
    }
  };

  const remove = async () => {
    if (!noteId) return;
    if (!window.confirm('Delete this card and its review history? This cannot be undone.')) return;
    await deleteNote(noteId);
    onDone?.('deleted');
  };

  return (
    <form
      className="note-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="field-grid">
        <Field label="Deck">
          <select value={chosenDeck} onChange={(e) => setDeckId(e.target.value)}>
            {DECK_CATEGORIES.map((cat) => (
              <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
                {decks
                  .filter((d) => (d.category ?? 'vocab') === cat)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </optgroup>
            ))}
            <option value={NEW_DECK}>New deck…</option>
          </select>
        </Field>
        {chosenDeck === NEW_DECK && (
          <>
            <Field label="New deck name">
              <input type="text" value={newDeck} onChange={(e) => setNewDeck(e.target.value)} placeholder="Lesson 07 – Family" />
            </Field>
            <Field label="Section">
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as DeckCategory)}>
                {DECK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>

      <NoteEditor key={formKey} draft={draft} onChange={setDraft} />
      {draft.kind === 'vocab' && <CardTypePicker value={cardTypes} onChange={setTypes} />}
      {draft.kind === 'vocab' && (
        <div className="field">
          <span className="field-label">Recording (optional)</span>
          <div className="actions">
            {audioId ? (
              <>
                <button type="button" className="btn btn-small" onClick={() => void playMedia(audioId)}>
                  Play recording
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    void removeMedia(audioId);
                    setAudioId(null);
                  }}
                >
                  Remove
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-small" onClick={() => audioInput.current?.click()}>
                Attach an audio file
              </button>
            )}
            <input
              ref={audioInput}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                if (f.size > 5 * 1024 * 1024) return setMessage('That file is over 5 MB. Trim it to just the word.');
                void saveMedia('audio', f).then((m) => setAudioId(m.id));
              }}
            />
          </div>
          <span className="muted small">Without a recording, the card is read aloud by the Swedish voice.</span>
        </div>
      )}

      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary">
          {noteId ? 'Save changes' : 'Add card'}
        </button>
        {noteId && (
          <>
            <button type="button" className="btn" onClick={() => onDone?.('cancelled')}>
              Cancel
            </button>
            <button type="button" className="btn" onClick={() => void setNoteSuspended(noteId, !allSuspended)}>
              {allSuspended ? 'Unsuspend' : 'Suspend'}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void remove()}>
              Delete
            </button>
          </>
        )}
      </div>
    </form>
  );
}
