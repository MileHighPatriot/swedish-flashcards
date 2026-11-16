import type { Gender, Note } from '../db/types';

/** The en/ett label. Same colours everywhere so gender is learned with the word. */
export function GenderTag({ gender }: { gender: Gender | null | undefined }) {
  if (!gender) return null;
  return (
    <span className={`gender gender-${gender}`} aria-label={`${gender} word`}>
      {gender}
    </span>
  );
}

/** One-line summary of a word's forms, e.g. "hunden · hundar" or "är · var · varit". */
export function formsSummary(note: Note): string {
  const parts: string[] = [];
  if (note.noun) parts.push(note.noun.definite, note.noun.plural);
  if (note.verb) parts.push(note.verb.present, note.verb.past, note.verb.supine);
  if (note.adjective) parts.push(note.adjective.neuter, note.adjective.plural);
  return parts.filter(Boolean).join(' · ');
}
