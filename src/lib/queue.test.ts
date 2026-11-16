import { describe, expect, it } from 'vitest';
import { CardState, DEFAULT_SETTINGS, type Card, type CardType, type Deck, type Note, type ReviewLog } from '../db/types';
import { makeCloze } from './cloze';
import { advance, buildQueue, cardsInScope, dropCurrent, remaining, startSession, type QueueInput } from './queue';
import { DAY_MS, newSchedState } from './scheduler';
import { topicFor } from './topics';

const NOW = new Date(2026, 10, 16, 10, 0).getTime();
const meta = (id: string, createdAt = 0) => ({ id, createdAt, updatedAt: 0, deletedAt: null });

const deck = (id: string, category: Deck['category'] = 'vocab'): Deck => ({ ...meta(id), name: id, category, lessonNumber: null, lessonName: '', description: '', locked: false });
const note = (id: string, deckId: string, i: number, tags: string[] = []): Note => ({
  ...meta(id, i), deckId, kind: 'vocab', grammar: null, swedish: id, english: id, pos: 'other', exampleSv: '', exampleEn: '', notes: '', tags,
  lessonNumber: null, lessonName: '', noun: null, verb: null, adjective: null, audioId: null, imageId: null, cardTypes: ['basic', 'reverse'],
});
const card = (id: string, n: Note, type: CardType = 'basic', patch: Partial<Card> = {}): Card => ({
  ...meta(id), ...newSchedState(NOW), noteId: n.id, deckId: n.deckId, type, suspended: false, leech: false, ...patch,
});
const review = (c: Card, due: number): Card => ({ ...c, state: CardState.Review, due, scheduledDays: 5, reps: 3 });
const log = (c: Card, state: number, cram = false): ReviewLog => ({
  ...meta(`log-${c.id}`), cardId: c.id, noteId: c.noteId, deckId: c.deckId, rating: 3, state: state as 0, reviewedAt: NOW - 1000, scheduledDays: 0, stability: 1, difficulty: 5, durationMs: 0, cram,
});

function world() {
  const decks = [deck('A'), deck('B'), deck('G', 'grammar')];
  const notes = [note('a1', 'A', 1, ['food']), note('a2', 'A', 2), note('a3', 'A', 3), note('b1', 'B', 4, ['food']), note('b2', 'B', 5), note('g1', 'G', 6)];
  const cards = notes.flatMap((n) => [card(`${n.id}-basic`, n), card(`${n.id}-reverse`, n, 'reverse')]);
  return { decks, notes, cards };
}
const input = (w: ReturnType<typeof world>, patch: Partial<QueueInput> = {}): QueueInput => ({
  ...w, logsToday: [], settings: { ...DEFAULT_SETTINGS, newPerDay: 10 }, now: NOW, rng: () => 0.42, ...patch,
});
const normal = { mode: 'normal' as const, shuffle: false };

describe('buildQueue', () => {
  it('introduces one sibling per word and takes turns across decks', () => {
    const q = buildQueue(input(world()), normal);
    expect(q.main).toEqual(['a1-basic', 'b1-basic', 'g1-basic', 'a2-basic', 'b2-basic', 'a3-basic']);
    expect(q.counts).toEqual({ learning: 0, review: 0, new: 6 });
  });

  it('respects the daily new limit, counting what was already introduced today', () => {
    const w = world();
    const few = input(w, { settings: { ...DEFAULT_SETTINGS, newPerDay: 2 } });
    expect(buildQueue(few, normal).main).toHaveLength(2);
    const seen = { ...w.cards[0], state: CardState.Learning, due: NOW + 60_000 };
    const cards = [seen, ...w.cards.slice(1)];
    const q = buildQueue({ ...few, cards, logsToday: [log(seen, CardState.New)] }, normal);
    expect(q.learning).toEqual(['a1-basic']);
    expect(q.main).toHaveLength(1);
    expect(q.main).not.toContain('a1-reverse'); // sibling waits for another day
    expect(buildQueue({ ...few, cards, logsToday: [log(seen, CardState.New)] }, { ...normal, extraNew: 3 }).main).toHaveLength(4);
  });

  it('puts due reviews before new cards and respects the review limit', () => {
    const w = world();
    w.cards[2] = review(w.cards[2], NOW - DAY_MS); // a2-basic, overdue
    w.cards[6] = review(w.cards[6], NOW + 2 * 3_600_000); // b1-basic, due later today
    w.cards[8] = review(w.cards[8], NOW + 3 * DAY_MS); // b2-basic, not due
    const q = buildQueue(input(w), normal);
    expect(q.main.slice(0, 2)).toEqual(['a2-basic', 'b1-basic']);
    expect(q.main).not.toContain('b2-basic');
    expect(q.main).not.toContain('a2-reverse'); // its sibling is being reviewed today
    const limited = buildQueue(input(w, { settings: { ...DEFAULT_SETTINGS, reviewsPerDay: 1 } }), normal);
    expect(limited.counts.review).toBe(1);
    expect(limited.main[0]).toBe('a2-basic');
  });

  it('ignores cram reviews when counting the daily limits', () => {
    const w = world();
    const q = buildQueue(input(w, { settings: { ...DEFAULT_SETTINGS, newPerDay: 1 }, logsToday: [log(w.cards[4], CardState.New, true)] }), normal);
    expect(q.main).toHaveLength(1);
  });

  it('never includes suspended or deleted cards', () => {
    const w = world();
    w.cards[0].suspended = true;
    w.cards[2].deletedAt = 1;
    const ids = buildQueue(input(w), normal).main;
    expect(ids).not.toContain('a1-basic');
    expect(ids).toContain('a1-reverse');
    expect(ids).not.toContain('a2-basic');
  });

  it('scopes by deck, section and tag', () => {
    const w = world();
    expect(new Set(cardsInScope(w, { deckId: 'B' }).map((c) => c.deckId))).toEqual(new Set(['B']));
    expect(cardsInScope(w, { category: 'grammar' }).map((c) => c.noteId)).toEqual(['g1', 'g1']);
    expect(new Set(cardsInScope(w, { tag: 'Food' }).map((c) => c.noteId))).toEqual(new Set(['a1', 'b1']));
    expect(buildQueue(input(w), { ...normal, tag: 'food' }).main).toEqual(['a1-basic', 'b1-basic']);
  });

  it('cram takes every card in scope regardless of schedule or limits', () => {
    const w = world();
    w.cards[2] = review(w.cards[2], NOW + 30 * DAY_MS);
    const q = buildQueue(input(w, { settings: { ...DEFAULT_SETTINGS, newPerDay: 0, reviewsPerDay: 0 } }), { mode: 'cram', shuffle: false, deckId: 'A' });
    expect(q.main).toEqual(['a1-basic', 'a1-reverse', 'a2-basic', 'a2-reverse', 'a3-basic', 'a3-reverse']);
  });

  it('shuffle changes the order but not the contents', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const plain = buildQueue(input(world()), normal).main;
    const mixed = buildQueue(input(world(), { rng }), { ...normal, shuffle: true }).main;
    expect([...mixed].sort()).toEqual([...plain].sort());
    expect(mixed).not.toEqual(plain);
  });
});

describe('session', () => {
  const due: Record<string, number> = {};
  const dueOf = (id: string) => due[id] ?? 0;

  it('shows learning cards when their timer is up, otherwise keeps going', () => {
    let s = startSession({ learning: [], main: ['x', 'y', 'z'], counts: { learning: 0, review: 0, new: 3 } }, 'normal', dueOf, NOW);
    expect(s.current).toBe('x');
    due.x = NOW + 60_000; // failed: back in one minute
    s = advance(s, true, true, dueOf, NOW);
    expect(s.current).toBe('y'); // x is not due yet
    expect(s.again).toBe(1);
    s = advance(s, false, false, dueOf, NOW + 61_000);
    expect(s.current).toBe('x'); // timer is up: x jumps the queue
    s = advance(s, false, false, dueOf, NOW + 62_000);
    expect(s.current).toBe('z');
    s = advance(s, false, false, dueOf, NOW + 63_000);
    expect(s.current).toBeNull();
    expect(s.done).toBe(4);
    expect(remaining(s)).toBe(0);
  });

  it('does not make me wait when only learning cards are left', () => {
    let s = startSession({ learning: [], main: ['x'], counts: { learning: 0, review: 0, new: 1 } }, 'normal', dueOf, NOW);
    due.x = NOW + 10 * 60_000;
    s = advance(s, true, false, dueOf, NOW);
    expect(s.current).toBe('x');
  });

  it('cram re-inserts a failed card a few cards later and never waits', () => {
    let s = startSession({ learning: [], main: ['a', 'b', 'c', 'd', 'e', 'f'], counts: { learning: 0, review: 0, new: 6 } }, 'cram', dueOf, NOW);
    s = advance(s, true, true, dueOf, NOW);
    expect([s.current, ...s.main]).toEqual(['b', 'c', 'd', 'e', 'a', 'f']);
  });

  it('dropCurrent skips a suspended card without counting it', () => {
    let s = startSession({ learning: [], main: ['a', 'b'], counts: { learning: 0, review: 0, new: 2 } }, 'normal', dueOf, NOW);
    s = dropCurrent(s, dueOf, NOW);
    expect(s.current).toBe('b');
    expect(s.done).toBe(0);
  });
});

describe('cloze', () => {
  const base = { noun: null, verb: null, adjective: null };
  it('blanks an inflected form of the word', () => {
    expect(makeCloze({ ...base, swedish: 'hund', noun: { gender: 'en', definite: 'hunden', plural: 'hundar' }, exampleSv: 'Hunden springer i parken.' })).toEqual({
      before: '', answer: 'Hunden', after: ' springer i parken.',
    });
    expect(makeCloze({ ...base, swedish: 'arbeta', verb: { infinitive: 'arbeta', present: 'arbetar', past: 'arbetade', supine: '' }, exampleSv: 'Igår arbetade jag i butiken.' })?.answer).toBe('arbetade');
  });
  it('only matches whole words, including next to å ä ö', () => {
    expect(makeCloze({ ...base, swedish: 'bo', exampleSv: 'Jag läser en bok om Sverige.' })).toBeNull();
    expect(makeCloze({ ...base, swedish: 'år', exampleSv: 'Våren är här. Ett år gick.' })?.before).toBe('Våren är här. Ett ');
  });
  it('returns null without an example', () => {
    expect(makeCloze({ ...base, swedish: 'svara', exampleSv: '' })).toBeNull();
  });
});

describe('topicFor', () => {
  const t = (tags: string[], prompt = '', answer = '') => topicFor({ tags, grammar: { prompt, answer, explanation: '', topic: null } });
  it('maps tags to the grammar page, most specific first', () => {
    expect(t(['my-mistake', 'verb-second'])).toBe('verb-second');
    expect(t(['my-mistake', 'past-tense', 'verb-second'])).toBe('verb-second');
    expect(t(['negation', 'word-order'])).toBe('inte');
    expect(t(['past-tense', '-te', 'lesson-02'])).toBe('past-te-de');
    expect(t(['past-tense', '-ade', 'lesson-01'])).toBe('past-ade');
    expect(t(['past-tense', 'lesson-02'])).toBe('past-te-de');
    expect(t(['my-mistake', 'past-tense'])).toBe('past-ade');
    expect(t(['questions', 'verb-second', 'lesson-02'])).toBe('questions');
    expect(t(['my-mistake', 'modals'])).toBe('modals');
    expect(t(['my-mistake', 'connectors'])).toBe('connectors');
    expect(t(['my-mistake', 'hem-hemma'])).toBe('hem-hemma');
    expect(t(['my-mistake', 'spelling', 'watch-spelling'])).toBe('spelling');
    expect(t(['pronunciation'])).toBe('pronunciation');
  });
  it('falls back to the text, then to nothing', () => {
    expect(t(['vocabulary', 'grammar'], 'What is the difference between hem and hemma?')).toBe('hem-hemma');
    expect(t(['plural'])).toBeNull();
    const why = (explanation: string) => topicFor({ tags: ['translate'], grammar: { prompt: '', answer: '', explanation, topic: null } });
    expect(why('Past tense + verb second.')).toBe('verb-second');
    expect(why('Question order + -te.')).toBe('questions');
    expect(why('bo → bodde.')).toBe('past-te-de');
    expect(why('-ade verbs.')).toBe('past-ade');
  });
});
