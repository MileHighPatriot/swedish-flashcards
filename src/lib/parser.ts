// Lesson-paste parser. Pure functions, no database access.
//
// Vocab line:    Swedish | English | forms | example = translation | tags
// Grammar line:  type | prompt | answer | explanation | tags     (type: rule, fix, reorder, translate)
// Sections:      "### Vocab", "### Phrases", "### Grammar rules", "### Fix the error",
//                "### Reorder", "### Translate"
//
// Tolerant of messy input: tabs, spaced dashes, "=", ":" or a comma instead of
// pipes, bullets and numbering, markdown tables and bold markers.

import { emptyDraft, type Draft, type GrammarKind, type PartOfSpeech } from '../db/types';

export type SectionHint = 'vocab' | 'phrases' | GrammarKind | null;

export interface ParsedItem {
  /** 1-based line number in the pasted text. */
  line: number;
  raw: string;
  draft: Draft | null;
  error: string | null;
  warnings: string[];
}

export interface ParsedSection {
  heading: string;
  hint: SectionHint;
  items: ParsedItem[];
}

export interface ParseResult {
  sections: ParsedSection[];
  /** Lines that could not be turned into a card. */
  errors: ParsedItem[];
  count: number;
}

const GRAMMAR_ALIASES: Record<string, GrammarKind> = {
  rule: 'rule',
  rules: 'rule',
  fix: 'fix',
  'fix the error': 'fix',
  error: 'fix',
  reorder: 'reorder',
  order: 'reorder',
  translate: 'translate',
  translation: 'translate',
};

/** What kind of lines a "### Heading" announces. */
export function hintForHeading(heading: string): SectionHint {
  const h = heading.toLowerCase();
  if (/\brules?\b/.test(h)) return 'rule';
  if (/\bfix|\berrors?\b|mistake/.test(h)) return 'fix';
  if (/reorder|scramble/.test(h)) return 'reorder';
  if (/translat/.test(h)) return 'translate';
  // A deck-style heading like "Grammar – Past tense & word order": go line by line.
  if (/^grammar\b/.test(h)) return null;
  if (/phrase|conversation|fras/.test(h)) return 'phrases';
  if (/vocab|\bwords?\b|glos|\bord\b/.test(h)) return 'vocab';
  return null;
}

function cleanField(f: string): string {
  return f
    .trim()
    .replace(/^(\*\*|__|`)(.*)\1$/, '$2')
    .replace(/^\*(.*)\*$/, '$1')
    .trim();
}

/** Strip bullets ("- ", "* ", "• ") and numbering ("3. ", "3) "). */
function stripBullet(line: string): string {
  return line.replace(/^\s*(?:[-*•–]\s+|\d+[.)]\s+)/, '');
}

/** Split a line into fields using the best separator it contains. */
export function splitFields(line: string): string[] {
  let parts: string[];
  if (line.includes('|')) {
    // Only a markdown table row (starts with a pipe) has a closing pipe to drop;
    // otherwise a trailing pipe means a deliberately empty last field.
    parts = (/^\s*\|/.test(line) ? line.replace(/^\s*\|/, '').replace(/\|\s*$/, '') : line).split('|');
  } else if (line.includes('\t')) {
    parts = line.split('\t');
  } else if (/\s[-–—]\s/.test(line)) {
    parts = line.split(/\s[-–—]\s/);
  } else if (/\s=\s/.test(line)) {
    const i = line.search(/\s=\s/);
    parts = [line.slice(0, i), line.slice(i + 3)];
  } else if (/:\s/.test(line)) {
    const i = line.search(/:\s/);
    parts = [line.slice(0, i), line.slice(i + 2)];
  } else if (line.includes(',')) {
    const i = line.indexOf(',');
    parts = [line.slice(0, i), line.slice(i + 1)];
  } else {
    parts = [line];
  }
  return parts.map(cleanField);
}

export function parseTags(field: string): string[] {
  const out: string[] = [];
  for (const t of field.split(/[,;]/)) {
    const tag = t.trim().replace(/^#/, '').replace(/\s+/g, '-');
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

const list = (field: string): string[] =>
  field
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Fill in the Swedish forms from the "forms" field. Never invents a form. */
function applyForms(d: Draft, field: string, warnings: string[]): void {
  let items = list(field);
  if (items.length === 0) return;

  // Noun: "en hund, hundar" / "en hund, hunden, hundar" / "ett, huset, hus"
  const article = /^(en|ett)(?:\s+(.+))?$/i.exec(items[0]);
  if (article || d.noun?.gender) {
    const gender = article ? (article[1].toLowerCase() as 'en' | 'ett') : d.noun!.gender;
    if (article) items = items.slice(1);
    d.noun = { gender, definite: '', plural: '' };
    if (items.length === 1) d.noun.plural = items[0];
    else if (items.length >= 2) [d.noun.definite, d.noun.plural] = items;
    if (items.length > 2) warnings.push(`Extra noun forms ignored: ${items.slice(2).join(', ')}`);
    d.pos = 'noun';
    return;
  }

  const base = d.swedish.toLowerCase();
  const first = items[0].toLowerCase();
  // Adjective: "stor, stort, stora" (starts with the word itself) or "stort, stora"
  if (items.length === 3 && first === base) {
    d.adjective = { common: items[0], neuter: items[1], plural: items[2] };
    d.pos = 'adjective';
    return;
  }
  if (items.length === 2 && first === base + 't') {
    d.adjective = { common: d.swedish, neuter: items[0], plural: items[1] };
    d.pos = 'adjective';
    return;
  }
  // Verb: "present, past", "present, past, supine" or "infinitive, present, past, supine"
  if (items.length >= 2 && items.length <= 4) {
    const [present, past, supine = ''] = items.length === 4 ? items.slice(1) : items;
    d.verb = { infinitive: items.length === 4 ? items[0] : d.swedish, present, past, supine };
    d.pos = 'verb';
    return;
  }
  if (items.length === 1 && (/^to\s/i.test(d.english) || d.pos === 'verb')) {
    d.verb = { infinitive: d.swedish, present: items[0], past: '', supine: '' };
    d.pos = 'verb';
    return;
  }
  d.notes = [d.notes, `Forms: ${items.join(', ')}`].filter(Boolean).join('\n');
  warnings.push('Could not tell what the forms are, so they were kept as a note.');
}

type LineResult = { draft: Draft | null; error: string | null; warnings: string[] };

export function parseVocabFields(fields: string[]): LineResult {
  const warnings: string[] = [];
  const [svRaw = '', en = '', forms = '', example = '', tags = '', ...extra] = fields;
  if (!svRaw || !en) {
    return { draft: null, error: 'Needs at least a Swedish word and an English meaning.', warnings };
  }
  const d = emptyDraft('vocab');
  d.english = en;

  // "en hund" / "ett hus" / "hund (en)" / "att äta"
  let sv = svRaw;
  const lead = /^(en|ett)\s+(\S+)$/i.exec(sv);
  const trail = /^(\S+)\s*\((en|ett)\)$/i.exec(sv);
  if (lead) {
    d.noun = { gender: lead[1].toLowerCase() as 'en' | 'ett', definite: '', plural: '' };
    sv = lead[2];
    d.pos = 'noun';
  } else if (trail) {
    d.noun = { gender: trail[2].toLowerCase() as 'en' | 'ett', definite: '', plural: '' };
    sv = trail[1];
    d.pos = 'noun';
  } else if (/^att\s+\S+$/i.test(sv)) {
    sv = sv.replace(/^att\s+/i, '');
    d.pos = 'verb';
  }
  d.swedish = sv;

  applyForms(d, forms, warnings);

  if (example) {
    const i = example.search(/\s=\s/);
    if (i >= 0) {
      d.exampleSv = example.slice(0, i).trim();
      d.exampleEn = example.slice(i + 3).trim();
    } else {
      // No "=": it's a remark, not a sentence pair.
      d.notes = [d.notes, example].filter(Boolean).join('\n');
    }
  }
  d.tags = parseTags(tags);
  if (extra.some(Boolean)) warnings.push(`Extra fields ignored: ${extra.filter(Boolean).join(' | ')}`);

  if (d.pos === 'other') {
    let pos: PartOfSpeech = 'other';
    if (/^to\s/i.test(en)) pos = 'verb';
    else if (/\s/.test(sv)) pos = 'phrase';
    d.pos = pos;
  }
  if (d.pos === 'verb' && !d.verb) d.verb = { infinitive: sv, present: '', past: '', supine: '' };
  return { draft: d, error: null, warnings };
}

export function parseGrammarFields(kind: GrammarKind, fields: string[]): LineResult {
  const warnings: string[] = [];
  const [prompt = '', answer = '', explanation = '', tags = '', ...extra] = fields;
  if (!prompt || !answer) return { draft: null, error: `A ${kind} card needs a prompt and an answer.`, warnings };
  const d = emptyDraft(kind);
  d.grammar = { prompt, answer, explanation, topic: null };
  d.tags = parseTags(tags);
  if (extra.some(Boolean)) warnings.push(`Extra fields ignored: ${extra.filter(Boolean).join(' | ')}`);
  if (kind === 'reorder' && splitChunks(prompt).length < 2)
    warnings.push('Reorder prompt should list the words separated by " / ".');
  return { draft: d, error: null, warnings };
}

/** Parse one line. `hint` is the kind announced by the section heading, if any. */
export function parseLine(raw: string, hint: SectionHint = null): LineResult {
  const fields = splitFields(stripBullet(raw));
  const keyword = GRAMMAR_ALIASES[fields[0]?.toLowerCase() ?? ''];
  const vocabSection = hint === 'vocab' || hint === 'phrases';
  if (keyword && fields.length >= 2 && !vocabSection) return parseGrammarFields(keyword, fields.slice(1));
  if (hint && !vocabSection) return parseGrammarFields(hint, fields);
  return parseVocabFields(fields);
}

const isTableRule = (line: string) => /^\s*\|?[\s:|-]*-{2,}[\s:|-]*$/.test(line);
const isHeaderRow = (line: string) => /^\s*\|?\s*(swedish|svenska|word|type)\s*[|\t]/i.test(line);

export function parseLesson(text: string): ParseResult {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  const errors: ParsedItem[] = [];
  let count = 0;

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const raw = rawLine.trim();
    if (!raw) return;
    const heading = /^#{2,6}\s+(.+?)\s*#*$/.exec(raw);
    if (heading) {
      current = { heading: heading[1], hint: hintForHeading(heading[1]), items: [] };
      sections.push(current);
      return;
    }
    // "# ..." is a comment (or a title); horizontal rules and table furniture are skipped.
    if (/^#(\s|$)/.test(raw) || /^([-*_=])\1{2,}$/.test(raw) || isTableRule(raw) || isHeaderRow(raw)) return;
    if (/^```/.test(raw)) return;

    if (!current) {
      current = { heading: '', hint: null, items: [] };
      sections.push(current);
    }
    const item: ParsedItem = { line: i + 1, raw, ...parseLine(raw, current.hint) };
    current.items.push(item);
    if (item.draft) count++;
    else errors.push(item);
  });

  return { sections: sections.filter((s) => s.items.length > 0), errors, count };
}

// ---------- helpers shared with the answer checkers ----------

/** "a // b" → ["a", "b"] */
export function splitAlternatives(answer: string): string[] {
  return answer
    .split(/\s*\/\/\s*/)
    .map((a) => a.trim())
    .filter(Boolean);
}

/** Split "Igår arbetar jag. (yesterday)" into the sentence and its bracketed hint. */
export function splitHint(prompt: string): { text: string; hint: string | null } {
  const m = /^(.*\S)\s*\(([^()]*)\)\s*$/.exec(prompt.trim());
  return m ? { text: m[1], hint: m[2] } : { text: prompt.trim(), hint: null };
}

/** "arbetade / jag / igår (Yesterday I worked.)" → ["arbetade", "jag", "igår"] */
export function splitChunks(prompt: string): string[] {
  return splitHint(prompt)
    .text
    .split(/\s*\/\s*/)
    .map((c) => c.trim())
    .filter(Boolean);
}
