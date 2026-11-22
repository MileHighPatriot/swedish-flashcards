import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Note } from '../db/types';
import { checkAnswer } from './check';
import { parseLesson } from './parser';
import { buildReasonContext, explainError, type ReasonContext } from './reasons';

// The context is built from my real seed files, so every form in a reason is one of mine.
const files = ['grammar-lessons-01-02.txt', 'lessons-01-02-extras.txt', 'lesson-03-irregular-verbs.txt', 'lesson-04-mixed-past-irregular.txt', 'lesson-05-modals-pronouns-review.txt'];
const notes = files.flatMap((f) =>
  parseLesson(readFileSync(new URL(`../../seed/${f}`, import.meta.url), 'utf8')).sections.flatMap((s) => s.items.flatMap((i) => (i.draft ? [{ ...i.draft, deletedAt: null } as unknown as Note] : []))),
);
const ctx = buildReasonContext(notes);
const why = (typed: string, expected: string, c: ReasonContext = ctx) => explainError(typed, expected, c);

describe('reasons from my own mistakes', () => {
  it('-ade on an -er verb: ringade, läsade, lekade', () => {
    expect(why('Jag ringade henne i går.', 'Jag ringde henne i går.')).toEqual({
      kind: 'ade-on-er',
      text: 'ringer ends in -er, so the past never takes -ade. The stem ring ends in g, not k, p, t, s or x, so it takes -de: ringde.',
    });
    expect(why('Igår läsade jag en bok.', 'I går läste jag en bok.')).toEqual({
      kind: 'ade-on-er',
      text: 'läser ends in -er, so the past never takes -ade. The stem läs ends in s, one of k, p, t, s, x, so it takes -te: läste.',
    });
    expect(why('Barnen lekade i parken.', 'Barnen lekte i parken.')?.kind).toBe('ade-on-er');
    expect(why('lekade', 'lekte')?.kind).toBe('ade-on-er');
  });

  it('-te and -de mixed up', () => {
    expect(why('Jag ringte min mamma.', 'Jag ringde min mamma.')).toEqual({ kind: 'te-de', text: 'The stem ring ends in g, not k, p, t, s or x, so it takes -de: ringde.' });
    expect(why('Jag köpde en bok.', 'Jag köpte en bok.')?.kind).toBe('te-de');
  });

  it('a regular ending on an irregular verb: görade, sovade, gåde', () => {
    expect(why('Hon görade middag.', 'Hon gjorde middag.')).toEqual({ kind: 'irregular-past', text: 'göra is irregular: the past is gjorde.' });
    expect(why('I morse sovade jag till klockan nio.', 'I morse sov jag till klockan nio.')).toEqual({ kind: 'irregular-past', text: 'sova is irregular: the past is sov.' });
    expect(why('Jag gåde hem.', 'Jag gick hem.')?.kind).toBe('irregular-past');
  });

  it('the third form where the past belongs: gått, and köpt once my cards know it', () => {
    expect(why('Jag gått hem.', 'Jag gick hem.')).toEqual({ kind: 'supine-as-past', text: 'gått is the third form, used after har. The past is gick.' });
    // köpa has no third form on my cards yet, so nothing is claimed about "köpt"…
    expect(why('Jag köpt en bok.', 'Jag köpte en bok.')).toBeNull();
    // …until a lesson supplies it.
    const withKopt = { ...ctx, verbs: [...ctx.verbs.filter((v) => v.infinitive !== 'köpa'), { infinitive: 'köpa', present: 'köper', past: 'köpte', supine: 'köpt' }] };
    expect(why('Jag köpt en bok.', 'Jag köpte en bok.', withKopt)).toEqual({ kind: 'supine-as-past', text: 'köpt is the third form, used after har. The past is köpte.' });
  });

  it('modal + infinitive: kan pratar, ska ringde, att after a modal, vill kaffe', () => {
    expect(why('Jag kan pratar svenska.', 'Jag kan prata svenska.')).toEqual({ kind: 'modal-infinitive', text: 'After kan, use the infinitive: prata.' });
    expect(why('Jag ska ringde på eftermiddagen.', 'Jag ska ringa på eftermiddagen.')).toEqual({ kind: 'modal-infinitive', text: 'After ska, use the infinitive: ringa.' });
    expect(why('Jag vill att äta middag.', 'Jag vill äta middag.')).toEqual({ kind: 'modal-infinitive', text: 'No att after a modal.' });
    expect(why('Jag vill kaffe.', 'Jag vill ha kaffe.')).toEqual({ kind: 'modal-infinitive', text: 'Use vill ha before a noun.' });
  });

  it('måste inte and får inte', () => {
    expect(why('Du måste inte komma.', 'Du får inte komma.')).toEqual({ kind: 'maste-far-inte', text: 'måste inte = do not have to; får inte = not allowed to.' });
  });

  it('verb second: Sedan vi tog tåget hem', () => {
    expect(why('Sedan vi tog tåget hem.', 'Sedan tog vi tåget hem.')).toEqual({ kind: 'verb-second', text: 'The verb takes seat 2: Sedan tog vi tåget hem.' });
    expect(why('I går jag blev trött.', 'I går blev jag trött.')?.kind).toBe('verb-second');
  });

  it('a yes/no question starts with the verb: I går blev du trött', () => {
    expect(why('I går blev du trött.', 'Blev du trött i går?')).toEqual({ kind: 'verb-first-question', text: 'A yes/no question starts with the verb: Blev du trött i går?' });
  });

  it('var and vart', () => {
    expect(why('I går kväll vart jag hemma.', 'I går kväll var jag hemma.')).toEqual({ kind: 'var-vart', text: 'var = was, and where for a place; vart = where to.' });
  });

  it('en and ett, den and det: läste det', () => {
    expect(why('Jag köpte en bok och läste det.', 'Jag köpte en bok och läste den.')).toEqual({ kind: 'en-ett', text: 'den for en-words, det for ett-words.' });
    expect(why('Vi tog en tåg hem.', 'Vi tog ett tåg hem.')).toEqual({ kind: 'en-ett', text: 'tåg is an ett-word.' });
  });

  it('subject and object forms: Vad sa honom', () => {
    expect(why('Vad sa honom?', 'Vad sa hon?')).toEqual({ kind: 'object-pronoun', text: 'As the subject use hon.' });
    expect(why('Jag ringde hon i går.', 'Jag ringde henne i går.')).toEqual({ kind: 'object-pronoun', text: 'After a verb or preposition use the object form: henne.' });
  });

  it('possessives: min barn', () => {
    expect(why('Jag lekte med min barn.', 'Jag lekte med mina barn.')).toEqual({ kind: 'possessive', text: 'min goes with en-words, mitt with ett-words, mina with plurals: mina barn.' });
  });

  it('inte in a main clause: Jag inte kan komma', () => {
    expect(why('Jag inte kan komma.', 'Jag kan inte komma.')).toEqual({ kind: 'negation-main', text: 'In a main clause inte comes right after the verb: Jag kan inte komma.' });
  });

  it('inte after att: Jag vet att han kommer inte', () => {
    expect(why('Jag vet att han kommer inte.', 'Jag vet att han inte kommer.')).toEqual({ kind: 'negation-subordinate', text: 'After att, inte comes before the verb: Jag vet att han inte kommer.' });
  });

  it('ingen, inget, inga: only before a noun whose form my cards know', () => {
    expect(why('Jag har ingen tåg.', 'Jag har inget tåg.')).toEqual({ kind: 'ingen-agreement', text: 'ingen goes with en-words, inget with ett-words, inga with plurals: inget tåg.' });
    expect(why('Jag har ingen systrar.', 'Jag har inga systrar.')?.kind).toBe('ingen-agreement');
    expect(why('Jag vill ingen.', 'Jag vill inget.')).toBeNull();
  });

  it('a missing chunk: lyssnade musik', () => {
    expect(why('Förra veckan lyssnade han musik.', 'Förra veckan lyssnade han på musik.')).toEqual({ kind: 'chunk', text: 'Learn it as one chunk: lyssna på (listen to).' });
    expect(why('Sedan satt jag soffan.', 'Sedan satt jag i soffan.')).toEqual({ kind: 'chunk', text: 'Learn it as one chunk: i soffan (on the sofa).' });
  });

  it('says nothing when two unrelated things are wrong, or when the answer is right', () => {
    expect(why('Jag ringade honom i går.', 'Jag ringde henne i går.')).toBeNull();
    expect(why('Efter middag jag gjorde trött.', 'Efter middagen blev jag trött.')).toBeNull();
    expect(why('Vi borde i Denver.', 'Vi bodde i Denver.')).toBeNull();
    expect(why('Jag ringde henne igår.', 'Jag ringde henne i går.')).toBeNull();
  });

  it('works on the alternative the checker matched', () => {
    const r = checkAnswer('Jag ringade henne igår.', 'Jag ringde henne i går. // I går ringde jag henne.');
    expect(r.verdict).toBe('wrong');
    expect(why('Jag ringade henne igår.', r.expected)?.kind).toBe('ade-on-er');
  });
});
