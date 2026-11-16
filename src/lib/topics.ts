// The grammar notes topics, and which one a card's "Review the rule" opens.

import type { Note } from '../db/types';

export interface Topic {
  slug: string;
  title: string;
}

export const TOPICS: Topic[] = [
  { slug: 'past-ade', title: 'Past tense: -ade' },
  { slug: 'past-te-de', title: 'Past tense: -te / -de' },
  { slug: 'verb-second', title: 'Verb second' },
  { slug: 'questions', title: 'Questions' },
  { slug: 'modals', title: 'Modals + infinitive' },
  { slug: 'connectors', title: 'så att / som' },
  { slug: 'inte', title: 'Where inte goes' },
  { slug: 'hem-hemma', title: 'hem / hemma' },
  { slug: 'spelling', title: 'Capitalization & spelling' },
  { slug: 'pronunciation', title: 'Pronunciation' },
];

/** Checked in order: the most specific tag wins. */
const TAG_RULES: [tags: string[], slug: string][] = [
  [['hem-hemma'], 'hem-hemma'],
  [['negation'], 'inte'],
  [['connectors'], 'connectors'],
  [['modals', 'infinitive'], 'modals'],
  [['pronunciation'], 'pronunciation'],
  [['questions'], 'questions'],
  [['verb-second', 'word-order'], 'verb-second'],
  [['-te', '-de'], 'past-te-de'],
  [['-ade'], 'past-ade'],
  [['spelling', 'watch-spelling'], 'spelling'],
];

/** The grammar page for a card, from its explicit topic, its tags, or its text. */
export function topicFor(note: Pick<Note, 'tags' | 'grammar'>): string | null {
  if (note.grammar?.topic) return note.grammar.topic;
  const tags = note.tags.map((t) => t.toLowerCase());
  for (const [keys, slug] of TAG_RULES) if (keys.some((k) => tags.includes(k))) return slug;
  if (tags.includes('past-tense')) return tags.includes('lesson-02') ? 'past-te-de' : 'past-ade';
  const text = `${note.grammar?.prompt ?? ''} ${note.grammar?.answer ?? ''}`.toLowerCase();
  if (/\bhemma\b/.test(text)) return 'hem-hemma';
  // Last resort: what the explanation talks about (e.g. cards tagged only "translate").
  const why = (note.grammar?.explanation ?? '').toLowerCase();
  if (/question/.test(why)) return 'questions';
  if (/verb second|seat 2/.test(why)) return 'verb-second';
  if (/-te\b|-de\b|bodde/.test(why)) return 'past-te-de';
  if (/-ade\b|past tense/.test(why)) return 'past-ade';
  return null;
}

export const topicTitle = (slug: string | null) => TOPICS.find((t) => t.slug === slug)?.title ?? null;
