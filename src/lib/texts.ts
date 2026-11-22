// Reading texts and dialogues: the built-in ones in seed/texts, the format
// they are written in, and looking a word up in my own cards.
//
// A text is plain lines:
//   # Lesson 03 – Title          (first "#" line is the title)
//   Speaker | Swedish | English  (a dialogue line)
//   Swedish | English            (a sentence with its meaning)
//   Swedish                      (just the sentence)
//   ? question | answer // other answer | line number
//                                (a Story mode question; never shown as text)
// A pasted paragraph with no pipes is split into sentences.

import type { Note } from '../db/types';
import { splitAlternatives } from './parser';

export interface TextLine {
  speaker: string;
  sv: string;
  en: string;
}

/** A Story mode question about the text, answered by typing Swedish. */
export interface TextQuestion {
  question: string;
  /** Accepted answers. Empty when the answer was never filled in: the question is then left out of the quiz. */
  answers: string[];
  /** 1-based line of the text that holds the answer, or null. */
  line: number | null;
}

export interface ReadingText {
  id: string;
  title: string;
  lesson: number | null;
  lines: TextLine[];
  questions: TextQuestion[];
  /** Built into the app (from seed/texts) rather than added by me. */
  builtIn: boolean;
  /** Role-play situations only: the group it is listed under, its English name, the scene and what I am trying to do. */
  category?: string;
  english?: string;
  scene?: string;
  goal?: string;
}

/** "One. Two? Three!" → ["One.", "Two?", "Three!"] */
export function splitSentences(paragraph: string): string[] {
  // A sentence ends at . ! ? followed by a space, so "9.30" stays in one piece.
  return paragraph
    .replace(/([.!?…]+["”’)]*)\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseText(raw: string, id: string, builtIn = false, fallbackTitle = ''): ReadingText {
  let title = fallbackTitle;
  let lesson: number | null = null;
  let titled = false;
  const meta: Pick<ReadingText, 'category' | 'english' | 'scene' | 'goal'> = {};
  const lines: TextLine[] = [];
  const questions: TextQuestion[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\?\s*\S/.test(line) && line.includes('|')) {
      const [question, answer = '', at = ''] = line.replace(/^\?\s*/, '').split('|').map((x) => x.trim());
      const n = Number(at);
      questions.push({ question, answers: splitAlternatives(answer), line: at && Number.isInteger(n) && n > 0 ? n : null });
      continue;
    }
    if (line.startsWith('#')) {
      if (titled) {
        const info = /^#+\s*(Category|English|Scene|Goal):\s*(.+)$/i.exec(line);
        if (info) meta[info[1].toLowerCase() as keyof typeof meta] = info[2].trim();
        continue;
      }
      titled = true;
      const m = /^#+\s*(?:Lesson\s+(\d+)\s*[-–—:]\s*)?(.*)$/i.exec(line);
      if (m?.[1]) lesson = Number(m[1]);
      if (m?.[2].trim()) title = m[2].trim();
      continue;
    }
    if (line.includes('|')) {
      const f = line.split('|').map((x) => x.trim());
      if (f.length >= 3) lines.push({ speaker: f[0], sv: f[1], en: f[2] });
      else lines.push({ speaker: '', sv: f[0], en: f[1] ?? '' });
      continue;
    }
    // "Svärmor: Hej!" is a dialogue line; anything else is prose.
    const spoken = /^([A-ZÅÄÖ][\p{L}-]{0,20}):\s+(.+)$/u.exec(line);
    if (spoken) lines.push({ speaker: spoken[1], sv: spoken[2], en: '' });
    else for (const sv of splitSentences(line)) lines.push({ speaker: '', sv, en: '' });
  }
  return { id, title: title || 'Untitled', lesson, lines: lines.filter((l) => l.sv), questions, builtIn, ...meta };
}

const files = import.meta.glob<string>('../../seed/texts/*.txt', { query: '?raw', import: 'default', eager: true });

export const BUILT_IN_TEXTS: ReadingText[] = Object.keys(files)
  .sort()
  .map((path) => parseText(files[path], `seed:${path.split('/').pop()!.replace(/\.txt$/, '')}`, true));

// Role-play situations that are not tied to a lesson: seed/situations/*.txt.
// Same line format, plus "# Category:", "# English:", "# Scene:" and "# Goal:".
const situationFiles = import.meta.glob<string>('../../seed/situations/*.txt', { query: '?raw', import: 'default', eager: true });

export const SITUATION_CATEGORIES = ['Everyday', 'Social', 'Family', 'Practical', 'Travel', 'Work and home'];

export const SITUATIONS: ReadingText[] = Object.keys(situationFiles)
  .sort()
  .map((path) => parseText(situationFiles[path], `seed:situation:${path.split('/').pop()!.replace(/\.txt$/, '')}`, true));

export const speakersOf = (t: ReadingText): string[] => [...new Set(t.lines.map((l) => l.speaker).filter(Boolean))];
export const isDialogue = (t: ReadingText): boolean => speakersOf(t).length >= 2;

// ---------- words ----------

export interface Token {
  text: string;
  /** A word (tappable), as opposed to spaces and punctuation. */
  word: boolean;
}

export function tokenize(sentence: string): Token[] {
  return (sentence.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*|[^\p{L}\p{N}]+/gu) ?? []).map((text) => ({ text, word: /[\p{L}\p{N}]/u.test(text) }));
}

export interface WordHit {
  note: Note;
  /** How the tapped word relates to the card, e.g. "past tense of gå". Empty when it is the word itself. */
  form: string;
}

export type Lexicon = Map<string, WordHit>;

const key = (w: string) => w.normalize('NFC').toLowerCase().trim();

/** Every form of every word I have a card for. The word itself wins over a form of another word. */
export function buildLexicon(notes: Note[]): Lexicon {
  const lex: Lexicon = new Map();
  const add = (word: string | undefined, hit: WordHit, strong = false) => {
    const k = key(word ?? '');
    if (!k || /\s/.test(k)) return;
    if (!lex.has(k) || (strong && lex.get(k)!.form)) lex.set(k, hit);
  };
  const vocab = notes.filter((n) => n.deletedAt == null && n.kind === 'vocab');
  for (const n of vocab) add(n.swedish, { note: n, form: '' }, true);
  for (const n of vocab) {
    const of = (label: string) => ({ note: n, form: `${label} of ${n.swedish}` });
    if (n.verb) {
      add(n.verb.infinitive, { note: n, form: '' });
      add(n.verb.present, of('present tense'));
      add(n.verb.past, of('past tense'));
      add(n.verb.supine, of('third form'));
    }
    if (n.noun) {
      add(n.noun.definite, of('the definite form'));
      add(n.noun.plural, of('plural'));
    }
    if (n.adjective) {
      add(n.adjective.common, { note: n, form: '' });
      add(n.adjective.neuter, of('ett form'));
      add(n.adjective.plural, of('plural form'));
    }
  }
  return lex;
}

export const lookup = (lex: Lexicon, word: string): WordHit | null => lex.get(key(word)) ?? null;

/** Share of the distinct words in a text that I already have a card for (0 to 1). */
export function knownShare(text: ReadingText, lex: Lexicon): number {
  const words = new Set(text.lines.flatMap((l) => tokenize(l.sv).filter((t) => t.word).map((t) => key(t.text))));
  if (words.size === 0) return 0;
  return [...words].filter((w) => lex.has(w)).length / words.size;
}
