// Verb drill: infinitive → past, with the stem-ending rule explained after each answer.

import type { Note } from '../db/types';

export interface DrillVerb {
  noteId: string;
  infinitive: string;
  english: string;
  past: string;
  lesson: string;
  tags: string[];
}

export interface PastRule {
  /** Which pattern the verb follows. */
  kind: 'ade' | 'te' | 'de' | 'dde' | 'irregular';
  /** One sentence shown after the answer. */
  text: string;
}

const VOWELS = 'aeiouyåäö';
const HARD = ['k', 'p', 't', 's', 'x'];

/** Work out which past-tense rule produced `past` from `infinitive`. */
export function pastRule(infinitive: string, past: string): PastRule {
  const inf = infinitive.trim().toLowerCase();
  const pst = past.trim().toLowerCase();
  const last = inf.slice(-1);

  // bo → bodde, tro → trodde: ends in a vowel other than the -a that gets dropped.
  if (VOWELS.includes(last) && last !== 'a' && pst === `${inf}dde`)
    return { kind: 'dde', text: `${inf} ends in a vowel, so the d doubles: ${inf} → ${pst}.` };

  if (last === 'a') {
    const stem = inf.slice(0, -1);
    const end = stem.slice(-1);
    if (pst === `${stem}ade`) return { kind: 'ade', text: `An -ar verb: drop the final -a and add -ade. ${inf} → ${pst}.` };
    if (pst === `${stem}te`) {
      const ck = stem.endsWith('ck') ? ' (ck counts as k)' : '';
      const fits = HARD.includes(end);
      return {
        kind: 'te',
        text: fits
          ? `The stem ${stem} ends in ${end}${ck}, one of k, p, t, s, x, so it takes -te: ${pst}.`
          : `It takes -te: ${stem} → ${pst}.`,
      };
    }
    if (pst === `${stem}de`) return { kind: 'de', text: `The stem ${stem} ends in ${end}, not k, p, t, s or x, so it takes -de: ${pst}.` };
    // känna → kände: a doubled consonant drops one before -de / -te.
    if (stem.length > 2 && stem.slice(-1) === stem.slice(-2, -1)) {
      const short = stem.slice(0, -1);
      if (pst === `${short}de`) return { kind: 'de', text: `It takes -de and loses one ${end}: ${stem} → ${pst}.` };
      if (pst === `${short}te`) return { kind: 'te', text: `It takes -te and loses one ${end}: ${stem} → ${pst}.` };
    }
  }
  return { kind: 'irregular', text: `Irregular: ${inf} → ${pst}. This one has to be learned by heart.` };
}

/** "lesson-01" → "Lesson 01" */
export const lessonLabel = (tag: string) => tag.replace(/^lesson-/i, 'Lesson ');

/** Every verb that has a past form, with the lesson it belongs to. */
export function drillVerbs(notes: Note[], suspendedNoteIds: Set<string> = new Set()): DrillVerb[] {
  const seen = new Set<string>();
  const out: DrillVerb[] = [];
  for (const n of notes) {
    if (n.deletedAt != null || n.kind !== 'vocab' || !n.verb?.past.trim() || suspendedNoteIds.has(n.id)) continue;
    const infinitive = (n.verb.infinitive || n.swedish).trim();
    const lesson = n.tags.find((t) => /^lesson-\d+$/i.test(t))?.toLowerCase() ?? (n.lessonNumber != null ? `lesson-${String(n.lessonNumber).padStart(2, '0')}` : '');
    // The same verb can sit in two lessons' decks; keep one per lesson.
    const key = `${lesson}:${infinitive.toLowerCase()}`;
    if (!lesson || seen.has(key)) continue;
    seen.add(key);
    out.push({ noteId: n.id, infinitive, english: n.english, past: n.verb.past.trim(), lesson, tags: n.tags });
  }
  return out;
}
