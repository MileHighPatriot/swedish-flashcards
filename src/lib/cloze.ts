import type { Note } from '../db/types';

export interface Cloze {
  before: string;
  /** The word as it appears in the sentence, e.g. "arbetade" for arbeta. */
  answer: string;
  after: string;
}

/** Every form of the word we know, longest first. */
export function knownForms(note: Pick<Note, 'swedish' | 'noun' | 'verb' | 'adjective'>): string[] {
  const forms = [
    note.swedish,
    note.noun?.definite,
    note.noun?.plural,
    note.verb?.infinitive,
    note.verb?.present,
    note.verb?.past,
    note.verb?.supine,
    note.adjective?.common,
    note.adjective?.neuter,
    note.adjective?.plural,
  ]
    .map((f) => f?.trim() ?? '')
    .filter(Boolean);
  return [...new Set(forms)].sort((a, b) => b.length - a.length);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Blank the word out of its example sentence. Looks for any known form as a
 * whole word (so "hunden" is found for "hund"). Returns null if the example
 * does not contain the word, in which case the card falls back to a plain prompt.
 */
export function makeCloze(note: Pick<Note, 'swedish' | 'noun' | 'verb' | 'adjective' | 'exampleSv'>): Cloze | null {
  const sentence = note.exampleSv.trim();
  if (!sentence) return null;
  let best: { index: number; length: number } | null = null;
  for (const form of knownForms(note)) {
    const m = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(form)}(?![\\p{L}\\p{N}])`, 'iu').exec(sentence);
    // Longest form wins; forms are sorted longest first, so the first hit is it.
    if (m) {
      best = { index: m.index, length: m[0].length };
      break;
    }
  }
  if (!best) return null;
  return {
    before: sentence.slice(0, best.index),
    answer: sentence.slice(best.index, best.index + best.length),
    after: sentence.slice(best.index + best.length),
  };
}
