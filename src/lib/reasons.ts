// Why a typed answer was wrong, in one sentence, for the mistakes I actually
// make. Every sentence is a fixed template filled with forms from my own cards
// (verb forms, noun genders) and the short closed lists below: nothing here
// makes up Swedish. A reason is only given when the difference is unambiguous
// (one word swapped, the same words in another order, or one chunk missing);
// otherwise the answer shows the diff alone.

import type { Note } from '../db/types';
import { twoWordTimeTyped } from './timewords';
import { pastRule } from './verbdrill';

export type ReasonKind =
  | 'ade-on-er'
  | 'te-de'
  | 'irregular-past'
  | 'supine-as-past'
  | 'modal-infinitive'
  | 'maste-far-inte'
  | 'verb-second'
  | 'verb-first-question'
  | 'var-vart'
  | 'en-ett'
  | 'object-pronoun'
  | 'possessive'
  | 'negation-main'
  | 'negation-subordinate'
  | 'ingen-agreement'
  | 'chunk';

export interface Reason {
  kind: ReasonKind;
  text: string;
}

export interface ReasonVerb {
  infinitive: string;
  present: string;
  past: string;
  supine: string;
}

export interface ReasonNoun {
  word: string;
  gender: 'en' | 'ett';
  definite: string;
  plural: string;
}

export interface ReasonContext {
  verbs: ReasonVerb[];
  nouns: ReasonNoun[];
}

const low = (s: string | undefined) => (s ?? '').normalize('NFC').trim().toLowerCase();

/** Verb forms and noun genders from my cards. One-word forms only. */
export function buildReasonContext(notes: Pick<Note, 'deletedAt' | 'kind' | 'swedish' | 'verb' | 'noun'>[]): ReasonContext {
  const verbs = new Map<string, ReasonVerb>();
  const nouns = new Map<string, ReasonNoun>();
  for (const n of notes) {
    if (n.deletedAt != null || n.kind !== 'vocab') continue;
    if (n.verb) {
      const v: ReasonVerb = { infinitive: low(n.verb.infinitive || n.swedish), present: low(n.verb.present), past: low(n.verb.past), supine: low(n.verb.supine) };
      if (v.infinitive && !/\s/.test(v.infinitive)) {
        // The same verb can sit in two decks: keep the fullest set of forms.
        const have = verbs.get(v.infinitive);
        const filled = (x: ReasonVerb) => [x.present, x.past, x.supine].filter(Boolean).length;
        if (!have || filled(v) > filled(have)) verbs.set(v.infinitive, v);
      }
    }
    if (n.noun?.gender) {
      const word = low(n.swedish);
      if (word && !/\s/.test(word) && !nouns.has(word)) nouns.set(word, { word, gender: n.noun.gender, definite: low(n.noun.definite), plural: low(n.noun.plural) });
    }
  }
  return { verbs: [...verbs.values()], nouns: [...nouns.values()] };
}

// ---------- the closed lists ----------

const MODALS = ['kan', 'kunde', 'vill', 'ville', 'ska', 'skulle', 'måste', 'får', 'fick'];
const SUBJECT = ['jag', 'du', 'han', 'hon', 'vi', 'ni', 'de'];
const OBJECT = ['mig', 'dig', 'honom', 'henne', 'oss', 'er', 'dem'];
const POSSESSIVES = [
  ['min', 'mitt', 'mina'],
  ['din', 'ditt', 'dina'],
  ['vår', 'vårt', 'våra'],
  ['er', 'ert', 'era'],
];
const INGEN = ['ingen', 'inget', 'inga'];
const NEGATIONS = ['inte', 'aldrig'];
const CONJUNCTIONS = ['att', 'om', 'när', 'eftersom', 'för att', 'som'];
/** Chunks to learn whole. A leading verb (lyssna, titta, gå, bli) matches any form of it on my cards. */
const CHUNKS: { chunk: string; english: string; verb?: string }[] = [
  { chunk: 'blev trött', english: 'got tired', verb: 'bli' },
  { chunk: 'i köket', english: 'in the kitchen' },
  { chunk: 'på golvet', english: 'on the floor' },
  { chunk: 'i soffan', english: 'on the sofa' },
  { chunk: 'lyssna på', english: 'listen to', verb: 'lyssna' },
  { chunk: 'titta på', english: 'watch', verb: 'titta' },
  { chunk: 'hela dagen', english: 'all day' },
  { chunk: 'till Sverige', english: 'to Sweden' },
  { chunk: 'i söndags', english: 'last Sunday' },
  { chunk: 'förra veckan', english: 'last week' },
  { chunk: 'gå på en match', english: 'go to a game', verb: 'gå' },
  { chunk: 'vill ha', english: 'want, before a noun' },
];

// ---------- helpers ----------

const PUNCT = /[.,!?;:"“”„'’()…¿¡]/g;

function words(s: string): string[] {
  const t = twoWordTimeTyped(s.normalize('NFC')).replace(PUNCT, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return t ? t.split(' ') : [];
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameBag = (a: string[], b: string[]) => same([...a].sort(), [...b].sort());
const without = (a: string[], i: number) => [...a.slice(0, i), ...a.slice(i + 1)];
const tidy = (expected: string) => expected.trim();

/** The one position where two equally long sentences differ, or null. */
function oneSwap(t: string[], e: string[]): { i: number; typed: string; expected: string } | null {
  if (t.length !== e.length) return null;
  const at = t.map((w, i) => (w === e[i] ? -1 : i)).filter((i) => i >= 0);
  return at.length === 1 ? { i: at[0], typed: t[at[0]], expected: e[at[0]] } : null;
}

const stemOf = (infinitive: string) => (infinitive.endsWith('a') ? infinitive.slice(0, -1) : infinitive);

function formsOf(v: ReasonVerb): string[] {
  return [v.infinitive, v.present, v.past, v.supine].filter(Boolean);
}

/** Index of `needle` as a run of words inside `hay`, or -1. */
function indexOfRun(hay: string[], needle: string[]): number {
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return i;
  return -1;
}

/** Longest common subsequence: which words of each side are shared. */
function shared(a: string[], b: string[]): [boolean[], boolean[]] {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const inA = new Array<boolean>(a.length).fill(false);
  const inB = new Array<boolean>(b.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) inA[i++] = inB[j++] = true;
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return [inA, inB];
}

// ---------- the reasons, in order of priority ----------

/**
 * Explain a wrong answer. `expected` is the accepted answer it was compared
 * with (one alternative, not the "a // b" list).
 */
export function explainError(typed: string, expected: string, ctx: ReasonContext): Reason | null {
  const t = words(typed);
  const e = words(expected);
  if (t.length === 0 || e.length === 0 || same(t, e)) return null;

  const swap = oneSwap(t, e);
  const finite = new Set<string>([...MODALS, ...ctx.verbs.flatMap((v) => [v.present, v.past].filter(Boolean))]);
  const nounFor = (w: string) => ctx.nouns.find((n) => n.word === w || n.definite === w || n.plural === w);

  if (swap) {
    const pasts = ctx.verbs.filter((v) => v.past && v.past === swap.expected);
    for (const v of pasts) {
      const rule = pastRule(v.infinitive, v.past);
      const stem = stemOf(v.infinitive);
      // ringa, ringer → "ringade"
      if (v.present.endsWith('er') && (rule.kind === 'te' || rule.kind === 'de') && swap.typed === `${stem}ade`)
        return { kind: 'ade-on-er', text: `${v.present} ends in -er, so the past never takes -ade. ${rule.text}` };
      // köpa → "köpde", ringa → "ringte"
      if ((rule.kind === 'te' && swap.typed === `${stem}de`) || (rule.kind === 'de' && swap.typed === `${stem}te`)) return { kind: 'te-de', text: rule.text };
      // gå → "gåde", sova → "sovade", göra → "görade"
      if (rule.kind === 'irregular' && [v.infinitive, stem].some((base) => ['ade', 'de', 'te', 'dde'].some((end) => swap.typed === base + end)))
        return { kind: 'irregular-past', text: `${v.infinitive} is irregular: the past is ${v.past}.` };
      if (v.supine && v.supine !== v.past && swap.typed === v.supine)
        return { kind: 'supine-as-past', text: `${swap.typed} is the third form, used after har. The past is ${v.past}.` };
    }

    // "kan pratar", "ska ringde": a present or past form where the infinitive belongs.
    const modalAt = lastModalBefore(e, swap.i);
    if (modalAt) {
      const v = ctx.verbs.find((x) => x.infinitive === swap.expected && [x.present, x.past].filter(Boolean).includes(swap.typed));
      if (v) return { kind: 'modal-infinitive', text: `After ${modalAt}, use the infinitive: ${v.infinitive}.` };
    }

    const pair = [swap.typed, swap.expected].sort().join(' ');
    if (pair === 'får måste' && t[swap.i + 1] === 'inte') return { kind: 'maste-far-inte', text: 'måste inte = do not have to; får inte = not allowed to.' };
  }

  // "Jag vill att äta": att slipped in after a modal.
  if (t.length === e.length + 1) {
    const i = t.findIndex((w, k) => w === 'att' && same(without(t, k), e));
    if (i > 0 && MODALS.includes(t[i - 1])) return { kind: 'modal-infinitive', text: 'No att after a modal.' };
  }
  // "Jag vill kaffe": vill needs ha before a noun.
  if (e.length === t.length + 1) {
    const i = e.findIndex((w, k) => w === 'ha' && k > 0 && ['vill', 'ville', 'vilja'].includes(e[k - 1]) && same(without(e, k), t));
    if (i > 0) return { kind: 'modal-infinitive', text: 'Use vill ha before a noun.' };
  }

  if (sameBag(t, e)) {
    // The subject before the verb after a first element: "Sedan vi tog tåget hem."
    // The går of "i går" is a time word, not the verb.
    const v = e.findIndex((w, k) => finite.has(w) && !(w === 'går' && e[k - 1] === 'i'));
    if (v >= 1 && v + 1 < e.length && !NEGATIONS.includes(e[v + 1]) && same(t, [...e.slice(0, v), e[v + 1], e[v], ...e.slice(v + 2)]))
      return { kind: 'verb-second', text: `The verb takes seat 2: ${tidy(expected)}` };
    if (/\?\s*$/.test(expected) && finite.has(e[0]) && t[0] !== e[0])
      return { kind: 'verb-first-question', text: `A yes/no question starts with the verb: ${tidy(expected)}` };
  }

  if (swap) {
    const pair = [swap.typed, swap.expected].sort().join(' ');
    if (pair === 'var vart') return { kind: 'var-vart', text: 'var = was, and where for a place; vart = where to.' };
    if (pair === 'en ett') {
      const noun = nounFor(e[swap.i + 1] ?? '');
      if (noun && noun.gender === swap.expected) return { kind: 'en-ett', text: `${noun.word} is an ${noun.gender}-word.` };
    }
    if (pair === 'den det') return { kind: 'en-ett', text: 'den for en-words, det for ett-words.' };

    if (OBJECT.includes(swap.expected) && SUBJECT.includes(swap.typed))
      return { kind: 'object-pronoun', text: `After a verb or preposition use the object form: ${swap.expected}.` };
    if (SUBJECT.includes(swap.expected) && OBJECT.includes(swap.typed)) return { kind: 'object-pronoun', text: `As the subject use ${swap.expected}.` };

    const set = POSSESSIVES.find((p) => p.includes(swap.typed) && p.includes(swap.expected));
    if (set) {
      const next = e[swap.i + 1];
      return { kind: 'possessive', text: `${set[0]} goes with en-words, ${set[1]} with ett-words, ${set[2]} with plurals: ${[swap.expected, next].filter(Boolean).join(' ')}.` };
    }
  }

  // Same words, only inte (or aldrig) in the wrong place.
  if (sameBag(t, e)) {
    for (const neg of NEGATIONS) {
      const te = t.indexOf(neg);
      const ee = e.indexOf(neg);
      if (te < 0 || ee < 0 || te === ee || !same(without(t, te), without(e, ee))) continue;
      const conj = conjunctionBefore(e, ee);
      // After att, om, när…: inte stands right before the verb, and I put it after.
      if (conj && finite.has(e[ee + 1] ?? '') && te > ee)
        return { kind: 'negation-subordinate', text: `After ${conj}, ${neg} comes before the verb: ${tidy(expected)}` };
      if (!conj) return { kind: 'negation-main', text: `In a main clause ${neg} comes right after the verb: ${tidy(expected)}` };
    }
  }

  if (swap && INGEN.includes(swap.typed) && INGEN.includes(swap.expected)) {
    const next = e[swap.i + 1] ?? '';
    const noun = nounFor(next);
    // Only when my cards say which form the noun needs. A bare "inget" can mean "nothing".
    const right = noun ? (noun.plural === next && noun.word !== next ? 'inga' : noun.word === next ? (noun.gender === 'en' ? 'ingen' : 'inget') : null) : null;
    if (right && right === swap.expected) return { kind: 'ingen-agreement', text: `ingen goes with en-words, inget with ett-words, inga with plurals: ${swap.expected} ${next}.` };
  }

  return chunkReason(t, e, ctx);
}

/** The modal (or "skulle vilja") governing position `i`: the nearest one before it. */
function lastModalBefore(e: string[], i: number): string | null {
  for (let k = i - 1; k >= 0; k--) {
    if (e[k] === 'vilja' && e[k - 1] === 'skulle') return 'skulle vilja';
    if (MODALS.includes(e[k])) return e[k];
  }
  return null;
}

/** The conjunction that opens the clause holding position `i`, if any. */
function conjunctionBefore(e: string[], i: number): string | null {
  for (let k = i - 1; k >= 0; k--) {
    if (e[k] === 'att' && e[k - 1] === 'för') return 'för att';
    if (CONJUNCTIONS.includes(e[k])) return e[k];
  }
  return null;
}

function chunkReason(t: string[], e: string[], ctx: ReasonContext): Reason | null {
  const [inT, inE] = shared(t, e);
  const missed = e.map((_, i) => i).filter((i) => !inE[i]);
  const extra = inT.filter((ok) => !ok).length;
  if (missed.length === 0) return null;
  for (const c of CHUNKS) {
    const parts = words(c.chunk);
    // Where the chunk sits in the right answer. A verb chunk may be split by the subject ("lyssnade han på").
    let at: number[] | null = null;
    if (c.verb) {
      const verb = ctx.verbs.find((v) => v.infinitive === c.verb);
      const heads = verb ? formsOf(verb) : [parts[0]];
      const rest = parts.slice(1);
      for (let i = 0; i < e.length && !at; i++) {
        if (!heads.includes(e[i])) continue;
        for (let gap = 0; gap <= 2 && !at; gap++) if (rest.every((w, j) => e[i + 1 + gap + j] === w)) at = [i, ...rest.map((_, j) => i + 1 + gap + j)];
      }
    } else {
      const i = indexOfRun(e, parts);
      if (i >= 0) at = parts.map((_, j) => i + j);
    }
    if (!at) continue;
    const spot = at;
    // Everything I missed is inside the chunk, and I did not write the chunk some other way round.
    if (missed.every((i) => spot.includes(i)) && extra <= parts.length) return { kind: 'chunk', text: `Learn it as one chunk: ${c.chunk} (${c.english}).` };
  }
  return null;
}
