import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Field } from '../components/NoteEditor';
import { createDeck, createNote, deleteText, emptyNoteInput, findDeckByName, saveText } from '../db/repo';
import { useSettings } from '../lib/hooks';
import { say } from '../lib/speech';
import { buildLexicon, isDialogue, knownShare, lookup, parseText, tokenize, type Lexicon, type ReadingText, type TextLine } from '../lib/texts';
import { formsSummary } from '../components/GenderTag';
import { SpeakButton } from '../study/CardView';
import { useNotes, useTexts } from './shared';

export const READER_DECK = 'Reader words';

export function WordPanel({ word, line, lex, onClose }: { word: string; line: TextLine; lex: Lexicon; onClose: () => void }) {
  const settings = useSettings();
  const hit = lookup(lex, word);
  const [english, setEnglish] = useState('');
  const [added, setAdded] = useState(false);

  const add = async () => {
    if (!english.trim()) return;
    const deck = (await findDeckByName(READER_DECK)) ?? (await createDeck({ name: READER_DECK, category: 'vocab', description: 'Words I picked up while reading.' }));
    await createNote({
      ...emptyNoteInput(deck.id, settings.defaultCardTypes),
      swedish: word.toLowerCase(),
      english: english.trim(),
      exampleSv: line.sv,
      exampleEn: line.en,
      tags: ['reader'],
    });
    setAdded(true);
  };

  return (
    <div className="word-panel" role="dialog" aria-label={`About the word ${word}`}>
      <div className="word-panel-head">
        <strong lang="sv">{word}</strong>
        <SpeakButton text={word} rate={settings.ttsRate} slowRate={settings.ttsSlowRate} label={`Hear ${word}`} />
        <button type="button" className="btn btn-small" onClick={onClose}>
          Close
        </button>
      </div>
      {hit ? (
        <>
          <p>
            {hit.form && <span className="muted">{hit.form}: </span>}
            {hit.note.english}
          </p>
          {formsSummary(hit.note) && (
            <p className="muted small" lang="sv">
              {formsSummary(hit.note)}
            </p>
          )}
          <Link className="btn btn-small" to={`/edit/${hit.note.id}`}>
            Open the card
          </Link>
        </>
      ) : added ? (
        <p role="status">Added to “{READER_DECK}”.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <p className="muted small">Not on your cards yet. Look it up, then add it with this sentence as its example.</p>
          <Field label="English meaning">
            <input type="text" value={english} autoFocus onChange={(e) => setEnglish(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={!english.trim()}>
            Add as a card
          </button>
        </form>
      )}
    </div>
  );
}

function TextView({ text, lex, onBack }: { text: ReadingText; lex: Lexicon; onBack: () => void }) {
  const settings = useSettings();
  const [showEnglish, setShowEnglish] = useState(false);
  const [open, setOpen] = useState<{ line: number; token: number } | null>(null);
  const hasEnglish = text.lines.some((l) => l.en);

  return (
    <>
      <button type="button" className="back-link btn-link" onClick={onBack}>
        ← All texts
      </button>
      <h2>{text.title}</h2>
      <p className="muted small">Tap any word. Dotted words are not on your cards yet.</p>
      <div className="actions">
        <button type="button" className="btn btn-small" onClick={() => say(text.lines.map((l) => l.sv).join(' '), settings.ttsRate)}>
          Read it all aloud
        </button>
        {hasEnglish && (
          <button type="button" className="btn btn-small" aria-pressed={showEnglish} onClick={() => setShowEnglish(!showEnglish)}>
            {showEnglish ? 'Hide English' : 'Show English'}
          </button>
        )}
        {isDialogue(text) && (
          <Link className="btn btn-small" to={`/practice/dialogue?text=${encodeURIComponent(text.id)}`}>
            Role-play it
          </Link>
        )}
      </div>
      <div className="reader">
        {text.lines.map((line, li) => (
          <div key={li} className="reader-line">
            <p lang="sv">
              {line.speaker && <span className="bubble-who">{line.speaker}: </span>}
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
              )}{' '}
              <button type="button" className="tok-play" aria-label="Hear this sentence" onClick={() => say(line.sv, settings.ttsRate)}>
                ▶
              </button>
            </p>
            {showEnglish && line.en && <p className="reader-en">{line.en}</p>}
            {open?.line === li && (
              <WordPanel key={`${li}:${open.token}`} word={tokenize(line.sv)[open.token].text} line={line} lex={lex} onClose={() => setOpen(null)} />
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function AddText({ onAdded }: { onAdded: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const count = parseText(body, 'draft').lines.length;
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!count) return;
        void saveText({ title: title.trim() || 'My text', body }).then((t) => onAdded(t.id));
      }}
    >
      <h2>Add a text</h2>
      <p className="muted small">
        Paste any Swedish: a news item from 8 Sidor, a message from family, a paragraph from your lesson chat. To include the meaning, put one sentence per line as{' '}
        <code>Swedish | English</code>. For a dialogue, use <code>Speaker | Swedish | English</code>.
      </p>
      <Field label="Title">
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <label className="field">
        <span className="field-label">Text</span>
        <textarea className="paste-box" rows={6} lang="sv" spellCheck={false} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={!count}>
        {count ? `Save (${count} sentence${count === 1 ? '' : 's'})` : 'Save'}
      </button>
    </form>
  );
}

export function Reader() {
  const texts = useTexts();
  const data = useNotes();
  const [params, setParams] = useSearchParams();
  const lex = useMemo(() => buildLexicon(data?.notes ?? []), [data]);
  if (!texts || !data) return <p className="muted">Loading…</p>;

  const open = texts.find((t) => t.id === params.get('text'));
  if (open) return <TextView key={open.id} text={open} lex={lex} onBack={() => setParams({})} />;

  return (
    <>
      <p className="muted">Short texts to read. Tap a word to see what it means, and add the ones you do not know as cards.</p>
      <ul className="list">
        {texts.map((t) => (
          <li key={t.id} className="list-item">
            <div className="list-link bar-row">
              <Link className="list-title reader-open" to={`/practice/reader?text=${encodeURIComponent(t.id)}`}>
                {t.lesson != null ? `Lesson ${t.lesson}: ` : ''}
                {t.title}
              </Link>
              <span className="list-meta">
                <span className="pill pill-tag">{Math.round(knownShare(t, lex) * 100)}% on cards</span>
                {isDialogue(t) && <span className="pill pill-tag">dialogue</span>}
                {!t.builtIn && (
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label={`Delete ${t.title}`}
                    onClick={() => window.confirm(`Delete “${t.title}”?`) && void deleteText(t.id)}
                  >
                    Delete
                  </button>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <AddText onAdded={(id) => setParams({ text: id })} />
    </>
  );
}
