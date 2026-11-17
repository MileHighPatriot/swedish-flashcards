// What the practice tools draw on: sentences to hear and say, nouns for the
// en/ett drill, and the journal's hand-off to Claude.

import type { Note } from '../db/types';
import { splitAlternatives, splitHint } from './parser';

export interface Sentence {
  sv: string;
  en: string;
  noteId: string;
  /** "lesson-03", or '' when the card has no lesson. */
  lesson: string;
  tags: string[];
}

const clean = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export function lessonOf(n: Pick<Note, 'tags' | 'lessonNumber'>): string {
  return n.tags.find((t) => /^lesson-\d+$/i.test(t))?.toLowerCase() ?? (n.lessonNumber != null ? `lesson-${String(n.lessonNumber).padStart(2, '0')}` : '');
}

/**
 * Every full Swedish sentence on my cards, once each: example sentences,
 * phrases, and the answers of translate, reorder and fix cards.
 */
export function sentencePool(notes: Note[], suspendedNoteIds: Set<string> = new Set()): Sentence[] {
  const seen = new Set<string>();
  const out: Sentence[] = [];
  const add = (n: Note, sv: string, en: string) => {
    const text = clean(sv);
    // A sentence, not a single word: at least two words.
    if (!/\S\s+\S/.test(text) || seen.has(text.toLowerCase())) return;
    seen.add(text.toLowerCase());
    out.push({ sv: text, en: clean(en), noteId: n.id, lesson: lessonOf(n), tags: n.tags });
  };
  for (const n of notes) {
    if (n.deletedAt != null || suspendedNoteIds.has(n.id)) continue;
    if (n.kind === 'vocab') {
      add(n, n.swedish, n.english);
      add(n, n.exampleSv, n.exampleEn);
    } else if (n.grammar && n.kind !== 'rule') {
      const en = n.kind === 'translate' ? splitHint(n.grammar.prompt).text : n.kind === 'reorder' ? (splitHint(n.grammar.prompt).hint ?? '') : '';
      add(n, splitAlternatives(n.grammar.answer)[0] ?? '', en);
    }
  }
  return out;
}

export interface DrillNoun {
  noteId: string;
  word: string;
  english: string;
  gender: 'en' | 'ett';
  definite: string;
  plural: string;
  lesson: string;
  tags: string[];
}

/** Every noun whose gender I have recorded, once each. */
export function drillNouns(notes: Note[], suspendedNoteIds: Set<string> = new Set()): DrillNoun[] {
  const seen = new Set<string>();
  const out: DrillNoun[] = [];
  for (const n of notes) {
    if (n.deletedAt != null || n.kind !== 'vocab' || !n.noun?.gender || suspendedNoteIds.has(n.id)) continue;
    const word = clean(n.swedish);
    if (seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push({ noteId: n.id, word, english: n.english, gender: n.noun.gender, definite: n.noun.definite, plural: n.noun.plural, lesson: lessonOf(n), tags: n.tags });
  }
  return out;
}

/** Local calendar date as "YYYY-MM-DD". */
export function dateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** What to paste into the lesson chat so the corrections come back as fix cards. */
export function journalForClaude(date: string, text: string): string {
  return [
    `Here is my Swedish journal entry for ${date}. Please correct it.`,
    '',
    text.trim(),
    '',
    'Reply in this order:',
    '1. The corrected version of the whole entry.',
    '2. One short line of encouragement about what I got right.',
    '3. Under a line that says exactly "### Fix the error", one line per real mistake, in exactly this format, so I can paste it into my flashcard app:',
    '',
    'fix | the sentence as I wrote it | the correct sentence | the rule in a few words | my-mistake, tag',
    '',
    'Rules for those lines: one mistake per line, whole sentences, no numbering or bullets, no bold.',
    'Tags are lowercase and comma separated. Use these where they fit: -ade, -te, -de, irregular, verb-second, word-order, questions, modals, connectors, negation, hem-hemma, spelling, watch-spelling, time-words.',
    'If there are no mistakes, say so and leave that section out.',
  ].join('\n');
}
