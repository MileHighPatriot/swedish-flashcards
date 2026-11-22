import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Note } from '../db/types';
import { parseLesson } from './parser';
import { DAY_MS } from './scheduler';
import { GROUP_LABELS, MISSING_FORM, filterVerbs, groupOf, pickForm, toDrillVerb, troubleNotes, verbTable, verbWeight, weightedPick } from './verbtable';

// My real seed files, read the way the app reads them.
const files = ['grammar-lessons-01-02.txt', 'lessons-01-02-extras.txt', 'lesson-03-irregular-verbs.txt', 'lesson-04-mixed-past-irregular.txt', 'lesson-05-modals-pronouns-review.txt'];
let n = 0;
const notes = files.flatMap((f, fi) =>
  parseLesson(readFileSync(new URL(`../../seed/${f}`, import.meta.url), 'utf8')).sections.flatMap((s) =>
    s.items.flatMap((i) => (i.draft ? [{ ...i.draft, id: `n${++n}`, deletedAt: null, lessonNumber: fi >= 2 ? fi + 1 : null } as unknown as Note] : [])),
  ),
);
const table = verbTable(notes);
const get = (inf: string) => table.find((v) => v.infinitive === inf)!;

describe('the verb table', () => {
  it('groups verbs by how the past is made', () => {
    expect(['köpa', 'ringa', 'bo', 'gå', 'kunna', 'arbeta', 'sova'].map((v) => [v, get(v).group])).toEqual([
      ['köpa', 'te'],
      ['ringa', 'de'],
      ['bo', 'dde'],
      ['gå', 'irregular'],
      ['kunna', 'modal'],
      ['arbeta', 'ar'],
      ['sova', 'irregular'],
    ]);
    expect(groupOf('känna', 'kände', [])).toBe('de');
    expect(groupOf('tro', 'trodde', ['-de'])).toBe('dde');
    expect(groupOf('måste', 'måste', ['verbs', 'modals'])).toBe('modal');
    expect(Object.values(GROUP_LABELS)).toEqual(['-ar (-ade)', '-er (-te)', '-er (-de)', 'short (-dde)', 'irregular', 'modal']);
  });

  it('has one row per verb, taking the forms from the fullest card', () => {
    expect(new Set(table.map((v) => v.infinitive)).size).toBe(table.length);
    // gå waits in the "coming soon" list with two forms and is complete in Lesson 3.
    expect(get('gå')).toMatchObject({ present: 'går', past: 'gick', supine: 'gått', english: 'go, walk' });
    expect(get('skriva')).toMatchObject({ present: 'skriver', past: 'skrev', supine: 'skrivit' });
    expect(get('skriva').lessons).toEqual([3, 4]);
    // få is irregular in Lesson 3 and a modal in Lesson 5: one row, in the modal group.
    expect(table.filter((v) => v.infinitive === 'få').length).toBe(1);
    expect(get('få').group).toBe('modal');
  });

  it('never fills in a form my lessons have not given', () => {
    expect(get('köpa').supine).toBe('');
    expect(get('ringa')).toMatchObject({ present: 'ringer', past: 'ringde', supine: '' });
    expect(MISSING_FORM).toBe('not in your lessons yet');
    // Every form shown is a form that stands in one of my files.
    const all = files.map((f) => readFileSync(new URL(`../../seed/${f}`, import.meta.url), 'utf8')).join('\n');
    for (const v of table) for (const f of [v.present, v.past, v.supine]) if (f) expect(all, `${v.infinitive}: ${f}`).toContain(f);
  });

  it('filters by group and by lesson', () => {
    expect(filterVerbs(table, 'dde', 'all').map((v) => v.infinitive)).toContain('bo');
    expect(filterVerbs(table, 'all', 4).map((v) => v.infinitive).sort((a, b) => a.localeCompare(b, 'sv'))).toEqual(['bli', 'dricka', 'ligga', 'sitta', 'skriva', 'stå', 'säga', 'vakna']);
    expect(filterVerbs(table, 'ar', 4).map((v) => v.infinitive)).toEqual(['vakna']);
    expect(filterVerbs(table, 'all', 'all').length).toBe(table.length);
  });
});

describe('drill weighting', () => {
  const now = Date.UTC(2026, 10, 22);
  it('finds the verbs I am getting wrong', () => {
    const trouble = troubleNotes({
      items: [
        { noteId: 'a', retiredAt: null, deletedAt: null },
        { noteId: 'retired', retiredAt: 5, deletedAt: null },
        { noteId: null, retiredAt: null, deletedAt: null },
      ],
      mistakes: [
        { noteId: 'b', at: now - 29 * DAY_MS, deletedAt: null },
        { noteId: 'old', at: now - 31 * DAY_MS, deletedAt: null },
        { noteId: 'gone', at: now, deletedAt: 1 },
      ],
      cards: [
        { noteId: 'c', lapses: 2, deletedAt: null },
        { noteId: 'fine', lapses: 0, deletedAt: null },
      ],
      now,
    });
    expect([...trouble].sort()).toEqual(['a', 'b', 'c']);
  });

  it('weights: 1, +2 for -er verbs, +2 for irregular, +3 for trouble', () => {
    const none = new Set<string>();
    expect(verbWeight(get('arbeta'), none)).toBe(1);
    expect(verbWeight(get('köpa'), none)).toBe(3);
    expect(verbWeight(get('ringa'), none)).toBe(3);
    expect(verbWeight(get('bo'), none)).toBe(3);
    expect(verbWeight(get('gå'), none)).toBe(3);
    expect(verbWeight(get('kunna'), none)).toBe(1);
    expect(verbWeight(get('arbeta'), new Set([get('arbeta').noteId]))).toBe(4);
    expect(verbWeight(get('ringa'), new Set([get('ringa').noteId]))).toBe(6);
  });

  it('draws heavier verbs more often, and never the same verb twice', () => {
    let s = 7;
    const rng = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    const items = ['light', 'heavy'];
    const firsts = Array.from({ length: 2000 }, () => weightedPick(items, (i) => (i === 'heavy' ? 6 : 1), 1, rng)[0]);
    const share = firsts.filter((x) => x === 'heavy').length / firsts.length;
    expect(share).toBeGreaterThan(0.8);
    expect(share).toBeLessThan(0.9);
    const all = weightedPick(table, (v) => verbWeight(v, new Set()), 10, rng);
    expect(new Set(all).size).toBe(10);
    expect(weightedPick(items, () => 1, 5, rng).sort()).toEqual(['heavy', 'light']);
    expect(weightedPick(items, () => 0, 5, rng)).toEqual([]);
  });

  it('asks mostly for the past, and only for forms the verb has', () => {
    const full = toDrillVerb(get('skriva'));
    const seq = [0.1, 0.59, 0.6, 0.79, 0.8, 0.99].map((r) => pickForm(full, () => r));
    expect(seq).toEqual(['past', 'past', 'present', 'present', 'supine', 'supine']);
    // köpa has no third form on my cards: the past is asked instead.
    expect(pickForm(toDrillVerb(get('köpa')), () => 0.95)).toBe('past');
    expect(pickForm({ past: '', present: '', supine: '' }, () => 0.5)).toBeNull();
  });
});
