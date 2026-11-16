import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_PAGES } from '../data/grammarPages';
import { CardState, DEFAULT_SETTINGS, type Card, type Mistake, type Note, type ReviewLog } from '../db/types';
import { Markdown } from './markdown';
import { buildQueue } from './queue';
import { newSchedState } from './scheduler';
import { TOPICS } from './topics';
import { drillVerbs, pastRule } from './verbdrill';
import { computeWeakSpots, exportForClaude, weakSpotCardIds } from './weakspots';

const NOW = new Date(2026, 10, 16, 10, 0).getTime();
const DAY = 86_400_000;
const meta = (id: string) => ({ id, createdAt: 0, updatedAt: 0, deletedAt: null });
const html = (source: string) => renderToStaticMarkup(<Markdown source={source} />);

describe('markdown', () => {
  it('renders headings, lists, emphasis and strike-through', () => {
    const h = html('# Title\n\nSome **bold** and *soft* text.\n\n- ~~Vi städa igår.~~ → Vi städade igår.\n- two\n\n1. first\n2. second');
    expect(h).toContain('<h2 class="md-title">Title</h2>');
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<em>soft</em>');
    expect(h).toContain('<del>Vi städa igår.</del> → Vi städade igår.');
    expect(h).toContain('<ol><li>first</li><li>second</li></ol>');
  });

  it('colour-codes endings in a table', () => {
    const h = html('| Stem ends in | Ending | Example |\n|---|---|---|\n| p | -te | köp → köpte |\n| g | -de | ring → ringde |\n| a vowel | -dde | bo → bodde |');
    expect(h).toContain('<span class="ending ending-te">-te</span>');
    expect(h).toContain('<span class="ending ending-de">-de</span>');
    expect(h).toContain('<span class="ending ending-de">-dde</span>');
    expect(h).toContain('<td>köp → köpte</td>');
  });

  it('draws a Seat table as the seat diagram with the verb column marked', () => {
    const h = html('| Seat 1 | Seat 2 (verb) | Seat 3 | Rest |\n|---|---|---|---|\n| Igår | arbetade | jag | i butiken. |\n| Jag | arbetade | | igår. |');
    expect(h).toContain('class="md-table md-seats"');
    expect(h).toContain('<td class="md-verb" lang="sv">arbetade</td>');
    expect(h.match(/<td/g)).toHaveLength(8); // the empty seat is still a cell
  });

  it('never emits raw HTML or unsafe links from pasted text', () => {
    const h = html('<script>alert(1)</script>\n\n[click](javascript:alert(1)) and [ok](https://forvo.com)\n\n<img src=x onerror=alert(1)>');
    expect(h).not.toContain('<script');
    expect(h).not.toContain('<img');
    expect(h).not.toContain('javascript:');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('href="https://forvo.com"');
  });

  it('every built-in page renders, and there is one for every topic', () => {
    expect(DEFAULT_PAGES.map((p) => p.slug)).toEqual(TOPICS.map((t) => t.slug));
    for (const p of DEFAULT_PAGES) {
      const h = html(p.markdown);
      expect(h).toContain('md-title');
      expect(h).not.toContain('undefined');
      // 3-5 examples or a table of them on every page
      expect((h.match(/<li>/g) ?? []).length + (h.match(/<tr>/g) ?? []).length).toBeGreaterThanOrEqual(4);
    }
    expect(html(DEFAULT_PAGES.find((p) => p.slug === 'past-te-de')!.markdown)).toContain('ending-te');
    expect(html(DEFAULT_PAGES.find((p) => p.slug === 'verb-second')!.markdown)).toContain('md-seats');
  });
});

describe('pastRule', () => {
  it('explains -ade verbs', () => {
    expect(pastRule('arbeta', 'arbetade')).toEqual({ kind: 'ade', text: 'An -ar verb: drop the final -a and add -ade. arbeta → arbetade.' });
  });
  it('explains -te by the stem ending', () => {
    expect(pastRule('köpa', 'köpte').text).toBe('The stem köp ends in p, one of k, p, t, s, x, so it takes -te: köpte.');
    expect(pastRule('läsa', 'läste').kind).toBe('te');
    expect(pastRule('tycka', 'tyckte').text).toContain('(ck counts as k)');
  });
  it('explains -de by the stem ending', () => {
    expect(pastRule('ringa', 'ringde').text).toBe('The stem ring ends in g, not k, p, t, s or x, so it takes -de: ringde.');
    expect(pastRule('höra', 'hörde').kind).toBe('de');
    expect(pastRule('leva', 'levde').kind).toBe('de');
  });
  it('handles the special cases', () => {
    expect(pastRule('bo', 'bodde')).toEqual({ kind: 'dde', text: 'bo ends in a vowel, so the d doubles: bo → bodde.' });
    expect(pastRule('tro', 'trodde').kind).toBe('dde');
    expect(pastRule('känna', 'kände').text).toBe('It takes -de and loses one n: känn → kände.');
  });
  it('calls everything else irregular', () => {
    for (const [inf, past] of [['gå', 'gick'], ['äta', 'åt'], ['vara', 'var'], ['göra', 'gjorde'], ['skriva', 'skrev'], ['måste', 'var tvungen']])
      expect(pastRule(inf, past).kind).toBe('irregular');
  });
});

// ---------- weak spots ----------

const note = (id: string, tags: string[], grammar?: [string, string], verb?: [string, string]): Note => ({
  ...meta(id), deckId: 'd', kind: grammar ? 'fix' : 'vocab', grammar: grammar ? { prompt: grammar[0], answer: grammar[1], explanation: '', topic: null } : null,
  swedish: verb?.[0] ?? id, english: `${id}-en`, pos: verb ? 'verb' : 'other', exampleSv: '', exampleEn: '', notes: '', tags, lessonNumber: null, lessonName: '',
  noun: null, verb: verb ? { infinitive: verb[0], present: '', past: verb[1], supine: '' } : null, adjective: null, audioId: null, imageId: null, cardTypes: [grammar ? 'fix' : 'basic'],
});
const card = (n: Note, patch: Partial<Card> = {}): Card => ({ ...meta(`c-${n.id}`), ...newSchedState(NOW), noteId: n.id, deckId: 'd', type: n.grammar ? 'fix' : 'basic', suspended: false, leech: false, ...patch });
let seq = 0;
const review = (c: Card, rating: 1 | 3, daysAgo = 0, cram = false): ReviewLog => ({
  ...meta(`r${seq++}`), cardId: c.id, noteId: c.noteId, deckId: 'd', rating, state: CardState.Review, reviewedAt: NOW - daysAgo * DAY, scheduledDays: 1, stability: 1, difficulty: 5, durationMs: 0, cram,
});
const mistake = (c: Card | null, typed: string, tags: string[] = [], at = NOW): Mistake => ({
  ...meta(`m${seq++}`), at, cardId: c?.id ?? null, noteId: c?.noteId ?? null, prompt: '', typed, correct: '', tags, topic: null, manual: !c,
});

function world() {
  const n1 = note('n1', ['my-mistake', 'verb-second', 'lesson-01'], ['Igår jag arbetade.', 'Igår arbetade jag.']);
  const n2 = note('n2', ['my-mistake', '-te'], ['Jag köpedde en bok.', 'Jag köpte en bok.']);
  const n3 = note('n3', ['verb-second', 'word-order'], ['I lördags jag åkte hem.', 'I lördags åkte jag hem.']);
  const n4 = note('n4', ['food', 'lesson-01']);
  const n5 = note('n5', ['watch-spelling']);
  const notes = [n1, n2, n3, n4, n5];
  const cards = notes.map((n) => card(n));
  const [c1, c2, , c4] = cards;
  const reviews = [review(c1, 1), review(c1, 1, 1), review(c1, 1, 2), review(c1, 3), review(c2, 1, 3), review(c4, 3), review(c4, 3, 9), review(c2, 1, 10, true)];
  const mistakes = [mistake(c1, 'Igår jag arbetade', [], NOW), mistake(c1, 'Igar arbetade jag', [], NOW - DAY), mistake(c1, 'Igår jag arbetade', [], NOW - 2 * DAY), mistake(c2, 'Jag köpde en bok', []), mistake(null, 'köpde', ['-te', 'verbs'])];
  return { notes, cards, reviews, mistakes, now: NOW };
}

describe('weak spots', () => {
  it('counts failures per card and per tag, ignoring lesson and my-mistake tags', () => {
    const s = computeWeakSpots(world());
    expect(s.cards.map((c) => [c.prompt, c.fails])).toEqual([
      ['Igår jag arbetade.', 3],
      ['Jag köpedde en bok.', 2],
    ]);
    expect(s.cards[0].typed).toEqual(['Igår jag arbetade', 'Igar arbetade jag']); // newest first, no repeats
    expect(s.tags).toEqual([
      { tag: '-te', fails: 3 }, // two card misses + one drill miss
      { tag: 'verb-second', fails: 3 },
      { tag: 'verbs', fails: 1 },
    ]);
    expect(s.totalFails).toBe(5);
    expect(s.reviewsThisWeek).toBe(6);
    expect(s.failsThisWeek).toBe(4);
  });

  it('builds a session: most-failed cards, then weak tags, then my-mistake cards', () => {
    const w = world();
    const ids = weakSpotCardIds(computeWeakSpots(w), w.cards, w.notes);
    expect(ids).toEqual(['c-n1', 'c-n2', 'c-n3']);
    expect(weakSpotCardIds(computeWeakSpots(w), w.cards, w.notes, 2)).toHaveLength(2);
  });

  it('leaves out suspended cards, and falls back when nothing has been failed yet', () => {
    const w = world();
    w.cards[0].suspended = true;
    expect(weakSpotCardIds(computeWeakSpots(w), w.cards, w.notes)).not.toContain('c-n1');
    const fresh = { ...world(), reviews: [], mistakes: [] };
    expect(weakSpotCardIds(computeWeakSpots(fresh), fresh.cards, fresh.notes)).toEqual(['c-n1', 'c-n2']);
    const none = { ...fresh, notes: fresh.notes.slice(3), cards: fresh.cards.slice(3) };
    expect(weakSpotCardIds(computeWeakSpots(none), none.cards, none.notes)).toEqual(['c-n5']);
  });

  it('the session queue crams exactly those cards, in order', () => {
    const w = world();
    const decks = [{ ...meta('d'), name: 'd', category: 'grammar' as const, lessonNumber: null, lessonName: '', description: '', locked: false }];
    const q = buildQueue({ cards: w.cards, notes: w.notes, decks, logsToday: [], settings: DEFAULT_SETTINGS, now: NOW }, { mode: 'cram', shuffle: false, cardIds: ['c-n3', 'missing', 'c-n1'] });
    expect(q.main).toEqual(['c-n3', 'c-n1']);
  });
});

describe('Export for Claude', () => {
  const md = exportForClaude(computeWeakSpots(world()), NOW);

  it('is well-formed markdown', () => {
    const lines = md.split('\n');
    expect(lines[0]).toBe('# Swedish flashcards: my weak spots (2026-11-16)');
    expect(lines.filter((l) => /^#{1,6} /.test(l))).toEqual([lines[0], '## Top weak tags', '## Most-failed cards']);
    // every heading has a blank line after it
    lines.forEach((l, i) => /^#{1,6} /.test(l) && expect(lines[i + 1]).toBe(''));
    // numbered lists count 1, 2, 3… within each section
    for (const section of md.split(/^## /m).slice(1)) {
      const nums = [...section.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
      expect(nums).toEqual(nums.map((_, i) => i + 1));
    }
    // balanced emphasis and code markers on every line
    for (const l of lines) {
      expect((l.match(/\*\*/g) ?? []).length % 2).toBe(0);
      expect((l.match(/`/g) ?? []).length % 2).toBe(0);
    }
    expect(md).not.toMatch(/undefined|null|NaN|\[object/);
    expect(md.endsWith('\n')).toBe(true);
    expect(() => html(md)).not.toThrow();
    expect(html(md)).toContain('<ol>');
  });

  it('has the weak tags, the failed cards with what I typed, and the week total', () => {
    expect(md).toContain('- Reviews in the last 7 days: **6**');
    expect(md).toContain('1. `-te`: 3 misses');
    expect(md).toContain('3. `verbs`: 1 miss');
    expect(md).toContain('1. **Igår jag arbetade.** → Igår arbetade jag.');
    expect(md).toContain('   - Failed 3 times');
    expect(md).toContain('   - I typed: "Igår jag arbetade"; "Igar arbetade jag"');
    expect(md).toContain('   - Tags: my-mistake, verb-second');
  });

  it('caps the lists at 10 tags and 15 cards', () => {
    const notes = Array.from({ length: 20 }, (_, i) => note(`x${i}`, [`tag-${String(i).padStart(2, '0')}`], [`prompt ${i}`, `answer ${i}`]));
    const cards = notes.map((n) => card(n));
    const out = exportForClaude(computeWeakSpots({ notes, cards, reviews: cards.map((c) => review(c, 1)), mistakes: [], now: NOW }), NOW);
    const [, tags, failed] = out.split(/^## /m);
    expect(tags.match(/^\d+\. /gm)).toHaveLength(10);
    expect(failed.match(/^\d+\. /gm)).toHaveLength(15);
  });

  it('says so when there is nothing to report', () => {
    const empty = exportForClaude(computeWeakSpots({ notes: [], cards: [], reviews: [], mistakes: [], now: NOW }), NOW);
    expect(empty).toContain('No misses recorded yet.');
    expect(empty).toContain('No failed cards yet.');
  });
});

describe('drillVerbs', () => {
  it('lists verbs with a past form by lesson, once each, skipping suspended ones', () => {
    const notes = [note('a', ['verbs', 'lesson-01'], undefined, ['arbeta', 'arbetade']), note('b', ['lesson-02'], undefined, ['köpa', 'köpte']), note('c', ['lesson-02'], undefined, ['köpa', 'köpte']), note('d', ['lesson-03'], undefined, ['gå', 'gick']), note('e', ['lesson-01'])];
    expect(drillVerbs(notes).map((v) => [v.infinitive, v.past, v.lesson])).toEqual([
      ['arbeta', 'arbetade', 'lesson-01'],
      ['köpa', 'köpte', 'lesson-02'],
      ['gå', 'gick', 'lesson-03'],
    ]);
    expect(drillVerbs(notes, new Set(['d'])).map((v) => v.infinitive)).toEqual(['arbeta', 'köpa']);
  });
});
