// Answer checking for typed cards: alternatives ("a // b"), forgiving å/ä/ö
// with a gentle warning, capital-letter warnings, and a diff of what was wrong.

import type { Note } from '../db/types';
import { splitAlternatives } from './parser';

export type Verdict = 'correct' | 'close' | 'wrong';

export interface Seg {
  text: string;
  /** false = this part is wrong (typed side) or was missed (expected side). */
  ok: boolean;
}

export interface CheckResult {
  verdict: Verdict;
  /** The accepted answer that was matched, or the nearest one if wrong. */
  expected: string;
  /** Gentle note for 'close' answers, e.g. "Close, watch the å." */
  message: string | null;
  /** What I typed, with the wrong parts marked. */
  typedDiff: Seg[];
  /** The right answer, with the parts I missed marked. */
  expectedDiff: Seg[];
}

const PUNCT = /[.,!?;:"“”„'’()…¿¡]/g;

/** Trim, tidy spaces, drop punctuation, and ignore the case of the first letter. */
export function canon(s: string): string {
  const t = s.normalize('NFC').replace(PUNCT, '').replace(/\s+/g, ' ').trim();
  return t.charAt(0).toLowerCase() + t.slice(1);
}

const FOLD: Record<string, string> = { å: 'a', ä: 'a', ö: 'o', é: 'e' };
/** å→a, ä→a, ö→o: what a keyboard without Swedish letters produces. */
export function foldSwedish(s: string): string {
  return s.replace(/[åäöé]/g, (c) => FOLD[c]);
}

function listLetters(letters: string[]): string {
  if (letters.length <= 1) return letters[0] ?? '';
  return `${letters.slice(0, -1).join(', ')} and ${letters[letters.length - 1]}`;
}

/** Which of å, ä, ö were expected where something else was typed. */
function missedLetters(typed: string, expected: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    if (e !== typed[i] && e in FOLD && !out.includes(e)) out.push(e);
  }
  return out.sort((a, b) => 'åäöé'.indexOf(a) - 'åäöé'.indexOf(b));
}

export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** Longest-common-subsequence diff. Returns which tokens of each side are shared. */
function lcsMarks<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): [boolean[], boolean[]] {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--) dp[i][j] = same(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const inA = new Array<boolean>(m).fill(false);
  const inB = new Array<boolean>(n).fill(false);
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (same(a[i], b[j])) {
      inA[i++] = true;
      inB[j++] = true;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return [inA, inB];
}

function toSegs(tokens: string[], ok: boolean[], joiner: string): Seg[] {
  const segs: Seg[] = [];
  tokens.forEach((t, i) => {
    const last = segs[segs.length - 1];
    if (last && last.ok === ok[i]) last.text += joiner + t;
    else segs.push({ text: (segs.length && joiner ? joiner : '') + t, ok: ok[i] });
  });
  return segs;
}

/**
 * Compare what was typed with the right answer. Sentences are compared word
 * by word, single words letter by letter. Punctuation never counts as an error.
 */
export function diffAnswer(typed: string, expected: string): { typed: Seg[]; expected: Seg[] } {
  const t = typed.normalize('NFC').replace(/\s+/g, ' ').trim();
  const e = expected.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (/\s/.test(e)) {
    const tw = t ? t.split(' ') : [];
    const ew = e.split(' ');
    const key = (w: string, i: number) => {
      const k = w.replace(PUNCT, '');
      return i === 0 ? k.charAt(0).toLowerCase() + k.slice(1) : k;
    };
    const tk = tw.map(key);
    const ek = ew.map(key);
    const [inT, inE] = lcsMarks(tk, ek, (x, y) => x === y);
    return { typed: toSegs(tw, inT, ' '), expected: toSegs(ew, inE, ' ') };
  }
  const tc = [...t];
  const ec = [...e];
  const [inT, inE] = lcsMarks(tc, ec, (x, y) => x === y);
  // Ignore the case of the very first letter.
  if (tc.length && ec.length && !inT[0] && !inE[0] && tc[0].toLowerCase() === ec[0].toLowerCase()) inT[0] = inE[0] = true;
  return { typed: toSegs(tc, inT, ''), expected: toSegs(ec, inE, '') };
}

const CAPS_MESSAGE = 'Right words. Check the capital letters: only the first word and names get one.';

function grade(typed: string, alt: string): { verdict: Verdict; message: string | null } {
  const t = canon(typed);
  const c = canon(alt);
  if (!t) return { verdict: 'wrong', message: null };
  if (t === c) return { verdict: 'correct', message: null };
  const tl = t.toLowerCase();
  const cl = c.toLowerCase();
  if (tl === cl) return { verdict: 'close', message: CAPS_MESSAGE };
  if (foldSwedish(tl) === foldSwedish(cl)) {
    const letters = missedLetters(tl, cl);
    return { verdict: 'close', message: `Close, watch the ${listLetters(letters)}.` };
  }
  return { verdict: 'wrong', message: null };
}

const RANK: Record<Verdict, number> = { correct: 2, close: 1, wrong: 0 };

/** Check a typed answer against one or more accepted answers ("a // b"). */
export function checkAnswer(typed: string, answer: string | string[]): CheckResult {
  const alts = Array.isArray(answer) ? answer : splitAlternatives(answer);
  let best: { alt: string; verdict: Verdict; message: string | null; dist: number } | null = null;
  for (const alt of alts) {
    const g = grade(typed, alt);
    const dist = editDistance(canon(typed).toLowerCase(), canon(alt).toLowerCase());
    if (!best || RANK[g.verdict] > RANK[best.verdict] || (RANK[g.verdict] === RANK[best.verdict] && dist < best.dist))
      best = { alt, ...g, dist };
  }
  const expected = best?.alt ?? '';
  const d = diffAnswer(typed, expected);
  const ok = best?.verdict === 'correct';
  return {
    verdict: best?.verdict ?? 'wrong',
    expected,
    message: best?.message ?? null,
    typedDiff: ok ? [{ text: typed.trim(), ok: true }] : d.typed,
    expectedDiff: ok ? [{ text: expected, ok: true }] : d.expected,
  };
}

/**
 * Check a typed Swedish word. "en hund" is accepted for "hund"; the wrong
 * article ("ett hund") is flagged gently so gender gets learned with the word.
 */
export function checkVocab(typed: string, note: Pick<Note, 'swedish' | 'noun' | 'verb'>): CheckResult {
  let t = typed.trim();
  let articleNote: string | null = null;
  const gender = note.noun?.gender;
  const m = /^(en|ett)\s+(.+)$/i.exec(t);
  if (m && !/^(en|ett)\s/i.test(note.swedish)) {
    if (gender && m[1].toLowerCase() !== gender) articleNote = `Right word, but it is “${gender} ${note.swedish}”.`;
    t = m[2];
  } else if (note.verb && /^att\s+/i.test(t) && !/^att\s/i.test(note.swedish)) {
    t = t.replace(/^att\s+/i, '');
  }
  const r = checkAnswer(t, [note.swedish]);
  if (r.verdict === 'correct' && articleNote) return { ...r, verdict: 'close', message: articleNote };
  return r;
}

/** Lenient check of an English meaning: any listed meaning counts ("hello, hi"). */
export function checkMeaning(typed: string, english: string): CheckResult {
  const strip = (s: string) =>
    canon(s.replace(/\([^)]*\)/g, ' '))
      .toLowerCase()
      .replace(/^(to|a|an|the)\s+/, '');
  const alts = english
    .split(/[,;/]/)
    .map((a) => a.trim())
    .filter(Boolean);
  const t = strip(typed);
  const hit = alts.find((a) => strip(a) === t) ?? (strip(english) === t ? english : undefined);
  if (t && hit) return { verdict: 'correct', expected: english, message: null, typedDiff: [{ text: typed.trim(), ok: true }], expectedDiff: [{ text: english, ok: true }] };
  return { verdict: 'wrong', expected: english, message: null, typedDiff: [{ text: typed.trim(), ok: false }], expectedDiff: [{ text: english, ok: false }] };
}

/** Split "Igår arbetar jag. (yesterday)" into the sentence and its hint. */
export function splitHint(prompt: string): { text: string; hint: string | null } {
  const m = /^(.*\S)\s*\(([^()]*)\)\s*$/.exec(prompt.trim());
  return m ? { text: m[1], hint: m[2] } : { text: prompt.trim(), hint: null };
}

/** Rating to pre-select after a checked answer: Good, Hard or Again. */
export function suggestedGrade(v: Verdict): 1 | 2 | 3 {
  return v === 'correct' ? 3 : v === 'close' ? 2 : 1;
}
