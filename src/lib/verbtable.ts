// The verb table: every verb on my cards with its forms, grouped by how its
// past tense is made, and the weighting that sends the hard ones to the drill
// more often. Forms come only from my cards; a missing one stays missing.

import type { Card, ID, Mistake, MistakeItem, Note } from '../db/types';
import { DAY_MS } from './scheduler';
import { lessonNumberOf } from './plan';
import { pastRule, type DrillVerb, type VerbForm } from './verbdrill';

export type VerbGroup = 'ar' | 'te' | 'de' | 'dde' | 'irregular' | 'modal';
export const VERB_GROUPS: VerbGroup[] = ['ar', 'te', 'de', 'dde', 'irregular', 'modal'];
export const GROUP_LABELS: Record<VerbGroup, string> = {
  ar: '-ar (-ade)',
  te: '-er (-te)',
  de: '-er (-de)',
  dde: 'short (-dde)',
  irregular: 'irregular',
  modal: 'modal',
};

export const MISSING_FORM = 'not in your lessons yet';

export interface TableVerb {
  noteId: ID;
  infinitive: string;
  present: string;
  past: string;
  supine: string;
  english: string;
  group: VerbGroup;
  /** Every lesson the verb appears in. */
  lessons: number[];
  tags: string[];
}

/** How the past is made, from the forms themselves. The modals tag wins: those are learned as a set. */
export function groupOf(infinitive: string, past: string, tags: string[]): VerbGroup {
  if (tags.some((t) => t.toLowerCase() === 'modals')) return 'modal';
  if (!past) return 'irregular';
  const kind = pastRule(infinitive, past).kind;
  return kind === 'ade' ? 'ar' : kind;
}

/** One row per infinitive. When a verb sits on several cards, the one with the most forms supplies them. */
export function verbTable(notes: Note[]): TableVerb[] {
  const byInf = new Map<string, { best: Note; forms: number; lessons: Set<number>; tags: Set<string> }>();
  for (const n of notes) {
    if (n.deletedAt != null || n.kind !== 'vocab' || !n.verb) continue;
    const inf = (n.verb.infinitive || n.swedish).trim().toLowerCase();
    if (!inf) continue;
    const forms = [n.verb.present, n.verb.past, n.verb.supine].filter((f) => f.trim()).length;
    const row = byInf.get(inf) ?? { best: n, forms: -1, lessons: new Set<number>(), tags: new Set<string>() };
    if (forms > row.forms) Object.assign(row, { best: n, forms });
    const lesson = lessonNumberOf(n);
    if (lesson != null) row.lessons.add(lesson);
    for (const t of n.tags) {
      row.tags.add(t);
      const m = /^lesson-(\d+)$/i.exec(t);
      if (m) row.lessons.add(Number(m[1]));
    }
    byInf.set(inf, row);
  }
  return [...byInf.entries()]
    .map(([infinitive, { best, lessons, tags }]) => {
      const v = best.verb!;
      const tagList = [...tags];
      return { noteId: best.id, infinitive, present: v.present.trim(), past: v.past.trim(), supine: v.supine.trim(), english: best.english, group: groupOf(infinitive, v.past.trim(), tagList), lessons: [...lessons].sort((a, b) => a - b), tags: tagList };
    })
    .sort((a, b) => a.infinitive.localeCompare(b.infinitive, 'sv'));
}

export function filterVerbs(verbs: TableVerb[], group: VerbGroup | 'all', lesson: number | 'all'): TableVerb[] {
  return verbs.filter((v) => (group === 'all' || v.group === group) && (lesson === 'all' || v.lessons.includes(lesson)));
}

export interface TroubleInput {
  items: Pick<MistakeItem, 'noteId' | 'retiredAt' | 'deletedAt'>[];
  mistakes: Pick<Mistake, 'noteId' | 'at' | 'deletedAt'>[];
  cards: Pick<Card, 'noteId' | 'lapses' | 'deletedAt'>[];
  now: number;
}

/** Verbs I am getting wrong: on my mistakes list, in the mistake log in the last 30 days, or with a lapsed card. */
export function troubleNotes({ items, mistakes, cards, now }: TroubleInput): Set<ID> {
  const out = new Set<ID>();
  for (const i of items) if (i.noteId && i.deletedAt == null && i.retiredAt == null) out.add(i.noteId);
  for (const m of mistakes) if (m.noteId && m.deletedAt == null && m.at >= now - 30 * DAY_MS) out.add(m.noteId);
  for (const c of cards) if (c.deletedAt == null && c.lapses > 0) out.add(c.noteId);
  return out;
}

/** 1 for every verb, +2 for an -er verb (-te, -de, -dde), +2 for an irregular one, +3 for one I am getting wrong. */
export function verbWeight(v: Pick<TableVerb, 'group' | 'noteId'>, trouble: ReadonlySet<ID>): number {
  return 1 + (v.group === 'te' || v.group === 'de' || v.group === 'dde' ? 2 : 0) + (v.group === 'irregular' ? 2 : 0) + (trouble.has(v.noteId) ? 3 : 0);
}

/** Draw `count` different items, each time in proportion to its weight. */
export function weightedPick<T>(items: T[], weight: (item: T) => number, count: number, rng: () => number = Math.random): T[] {
  const pool = items.map((item) => ({ item, w: Math.max(0, weight(item)) })).filter((x) => x.w > 0);
  const out: T[] = [];
  while (out.length < count && pool.length) {
    let r = rng() * pool.reduce((sum, x) => sum + x.w, 0);
    let i = 0;
    while (i < pool.length - 1 && r >= pool[i].w) r -= pool[i++].w;
    out.push(pool.splice(i, 1)[0].item);
  }
  return out;
}

/** Mostly the past, with the present and the third form mixed in. Only forms the verb has. */
export function pickForm(v: Pick<DrillVerb, 'past' | 'present' | 'supine'>, rng: () => number = Math.random): VerbForm | null {
  const r = rng();
  const wanted: VerbForm = r < 0.6 ? 'past' : r < 0.8 ? 'present' : 'supine';
  const order: VerbForm[] = [wanted, 'past', 'present', 'supine'];
  return order.find((f) => v[f]) ?? null;
}

export const toDrillVerb = (v: TableVerb): DrillVerb => ({ noteId: v.noteId, infinitive: v.infinitive, english: v.english, past: v.past, present: v.present, supine: v.supine, lesson: '', tags: v.tags });
