import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { listCards, listNotes, listTexts, removeMedia, saveMedia } from '../db/repo';
import { db } from '../db/db';
import type { ID } from '../db/types';
import { sentencePool, type Sentence } from '../lib/practice';
import { buildReasonContext, type ReasonContext } from '../lib/reasons';
import { recorderSupported, useRecorder } from '../lib/recorder';
import { BUILT_IN_TEXTS, parseText, type ReadingText } from '../lib/texts';
import { lessonLabel } from '../lib/verbdrill';

/** Notes with the ids of those that have no card in rotation (locked or suspended). */
export function useNotes() {
  return useLiveQuery(async () => {
    const [notes, cards] = await Promise.all([listNotes(), listCards()]);
    const active = new Set(cards.filter((c) => !c.suspended).map((c) => c.noteId));
    return { notes, resting: new Set(notes.filter((n) => !active.has(n.id)).map((n) => n.id)) };
  }, []);
}

/** Verb forms and noun genders from my cards, for naming why a typed answer was wrong. */
export function useReasons(): ReasonContext | undefined {
  return useLiveQuery(async () => buildReasonContext(await listNotes()), []);
}

export function useSentences(): Sentence[] | undefined {
  const data = useNotes();
  return data && sentencePool(data.notes, data.resting);
}

/** Built-in texts plus the ones I added, newest of mine first. */
export function useTexts(): ReadingText[] | undefined {
  const mine = useLiveQuery(listTexts, []);
  return mine && [...mine.map((t) => parseText(t.body, t.id, false, t.title)), ...BUILT_IN_TEXTS];
}

export const ALL = 'all';

export function LessonSelect<T extends { lesson: string }>({ items, value, onChange }: { items: T[]; value: string; onChange: (v: string) => void }) {
  const lessons = [...new Set(items.map((i) => i.lesson).filter(Boolean))].sort();
  return (
    <label className="field">
      <span className="field-label">Lesson</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL}>All lessons ({items.length})</option>
        {lessons.map((l) => (
          <option key={l} value={l}>
            {lessonLabel(l)} ({items.filter((i) => i.lesson === l).length})
          </option>
        ))}
      </select>
    </label>
  );
}

export const inLesson = <T extends { lesson: string }>(items: T[], lesson: string): T[] => (lesson === ALL ? items : items.filter((i) => i.lesson === lesson));

/** Record my voice and play it back. Give it a `key` per sentence so each one starts clean. */
export function Recorder() {
  const rec = useRecorder();
  if (!recorderSupported()) return <p className="muted small">This browser cannot record. Say it out loud instead.</p>;
  const recording = rec.state === 'recording';
  return (
    <div className="recorder">
      <div className="actions">
        <button
          type="button"
          className={recording ? 'btn btn-rec is-recording' : 'btn btn-rec'}
          aria-pressed={recording}
          disabled={rec.state === 'starting'}
          onClick={() => (recording ? rec.stop() : void rec.start())}
        >
          <span className="rec-dot" aria-hidden="true" />
          {recording ? 'Stop' : rec.state === 'starting' ? 'Waiting for the microphone…' : rec.hasRecording ? 'Record again' : 'Record myself'}
        </button>
        {rec.hasRecording && !recording && (
          <button type="button" className="btn" onClick={rec.play}>
            Play mine
          </button>
        )}
      </div>
      {rec.state === 'denied' && (
        <p className="small notice" role="alert">
          The microphone is blocked. Allow it for this site in your browser settings, then try again.
        </p>
      )}
      {rec.state === 'error' && (
        <p className="small notice" role="alert">
          Could not start the microphone.
        </p>
      )}
    </div>
  );
}

/** Plays one saved recording from the media table. */
function SavedClip({ id, label, onDelete }: { id: ID; label: string; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    void db.media.get(id).then((m) => {
      if (!m || m.deletedAt != null || !m.blob.size) return;
      made = URL.createObjectURL(m.blob);
      setUrl(made);
    });
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  if (!url) return null;
  return (
    <li className="saved-clip">
      <audio controls src={url} aria-label={label} />
      <button type="button" className="btn btn-small" aria-label={`Delete ${label.toLowerCase()}`} onClick={onDelete}>
        Delete
      </button>
    </li>
  );
}

/**
 * Record answers and keep them: each recording is saved in the media table on
 * this device (never synced; it does go into a backup file). `ids` is the list
 * the caller stores; `onChange` gets the new list after a recording or a delete.
 */
export function SavedRecorder({ ids, onChange, what = 'answer' }: { ids: ID[]; onChange: (ids: ID[]) => void; what?: string }) {
  const rec = useRecorder((blob) => void saveMedia('audio', blob).then((m) => onChange([...ids, m.id])));
  if (!recorderSupported())
    return (
      <p className="small notice" role="status">
        This browser cannot record. Type your {what} instead; nothing else is lost.
      </p>
    );
  const recording = rec.state === 'recording';
  return (
    <div className="recorder">
      <div className="actions">
        <button type="button" className={recording ? 'btn btn-rec is-recording' : 'btn btn-rec'} aria-pressed={recording} disabled={rec.state === 'starting'} onClick={() => (recording ? rec.stop() : void rec.start())}>
          <span className="rec-dot" aria-hidden="true" />
          {recording ? 'Stop and save' : rec.state === 'starting' ? 'Waiting for the microphone…' : ids.length ? `Record another ${what}` : `Record my ${what}`}
        </button>
      </div>
      {rec.state === 'denied' && (
        <p className="small notice" role="alert">
          The microphone is blocked. Allow it for this site in your browser settings, or type your {what} instead.
        </p>
      )}
      {rec.state === 'error' && (
        <p className="small notice" role="alert">
          Could not start the microphone. You can still type your {what}.
        </p>
      )}
      {ids.length > 0 && (
        <ul className="saved-clips" aria-label="Saved recordings">
          {ids.map((id, i) => (
            <SavedClip
              key={id}
              id={id}
              label={`Recording ${i + 1}`}
              onDelete={() => {
                void removeMedia(id);
                onChange(ids.filter((x) => x !== id));
              }}
            />
          ))}
        </ul>
      )}
      {ids.length > 0 && <p className="muted small">Saved on this device only. Recordings are not synced; they are included in a backup file.</p>}
    </div>
  );
}
