import { describe, expect, it } from 'vitest';
import type { Card, Note } from '../db/types';
import { checkVocab, suggestedGrade } from '../lib/check';
import { buildReasonContext } from '../lib/reasons';
import { isFlipCard, mistakeInputFor, reverseIsTyped, withReason } from './CardView';

const note = (over: Partial<Note>): Note =>
  ({ id: 'n', deckId: 'd', kind: 'vocab', grammar: null, swedish: 'hund', english: 'dog', pos: 'noun', exampleSv: '', exampleEn: '', notes: '', tags: ['animals'], lessonNumber: null, lessonName: '', noun: { gender: 'en', definite: 'hunden', plural: 'hundar' }, verb: null, adjective: null, audioId: null, imageId: null, cardTypes: ['basic', 'reverse'], createdAt: 0, updatedAt: 0, deletedAt: null, ...over }) as Note;
const card = (type: Card['type']) => ({ id: `c-${type}`, noteId: 'n', type }) as Card;

describe('English → Swedish cards', () => {
  it('are typed when the setting is on, and flip when it is off', () => {
    expect(reverseIsTyped(note({}), true, new Set())).toBe(true);
    expect(reverseIsTyped(note({}), false, new Set())).toBe(false);
    expect(isFlipCard(card('reverse'), true)).toBe(false);
    expect(isFlipCard(card('reverse'), false)).toBe(true);
    expect(isFlipCard(card('reverse'))).toBe(true);
    // Nothing else changes type.
    expect(isFlipCard(card('basic'), true)).toBe(true);
    expect(isFlipCard(card('typed'), false)).toBe(false);
  });

  it('with the setting off, verbs and anything on my mistakes list stay typed', () => {
    const ringa = note({ id: 'v', swedish: 'ringa', english: 'call', pos: 'verb', noun: null, verb: { infinitive: 'ringa', present: 'ringer', past: 'ringde', supine: '' } });
    expect(reverseIsTyped(ringa, false, new Set())).toBe(true);
    expect(reverseIsTyped(note({ id: 'x' }), false, new Set(['x']))).toBe(true);
    expect(reverseIsTyped(note({ id: 'x' }), false, new Set(['y']))).toBe(false);
  });

  it('are graded like a typed word: article accepted, wrong article close, å forgiving, grade suggested', () => {
    const hund = note({});
    expect(suggestedGrade(checkVocab('hund', hund).verdict)).toBe(3);
    expect(suggestedGrade(checkVocab('en hund', hund).verdict)).toBe(3);
    expect(checkVocab('ett hund', hund)).toMatchObject({ verdict: 'close', message: 'Right word, but it is “en hund”.' });
    expect(suggestedGrade(checkVocab('ett hund', hund).verdict)).toBe(2);
    expect(suggestedGrade(checkVocab('katt', hund).verdict)).toBe(1);
    const igar = note({ swedish: 'i går', english: 'yesterday', pos: 'phrase', noun: null });
    expect(checkVocab('igår', igar).verdict).toBe('correct');
    expect(checkVocab('igar', igar).verdict).toBe('close');
  });

  it('a wrong typed answer gets its reason and becomes a mistake with the English as its prompt', () => {
    const ringa = note({ id: 'v', swedish: 'ringa', english: 'call', pos: 'verb', noun: null, verb: { infinitive: 'ringa', present: 'ringer', past: 'ringde', supine: '' } });
    const ctx = buildReasonContext([ringa]);
    const a = withReason({ typed: 'ringade', check: { verdict: 'wrong', expected: 'ringde', message: null, typedDiff: [], expectedDiff: [] } }, ctx);
    expect(a.reason?.kind).toBe('ade-on-er');
    expect(withReason({ typed: 'ringde', check: { verdict: 'correct', expected: 'ringde', message: null, typedDiff: [], expectedDiff: [] } }, ctx).reason).toBeUndefined();
    expect(mistakeInputFor(card('reverse'), ringa)).toEqual({ cardId: 'c-reverse', noteId: 'v', tags: ['animals'], prompt: 'call', correct: 'ringa' });
    const fix = note({ kind: 'fix', grammar: { prompt: 'Sedan vi tog tåget hem.', answer: 'Sedan tog vi tåget hem.', explanation: '', topic: null } });
    expect(mistakeInputFor(card('fix'), fix)).toMatchObject({ prompt: 'Fix this sentence: Sedan vi tog tåget hem.', correct: 'Sedan tog vi tåget hem.' });
    const reorder = note({ kind: 'reorder', grammar: { prompt: 'satt / jag / i soffan / sedan (Then I sat on the sofa.)', answer: 'Sedan satt jag i soffan.', explanation: '', topic: null } });
    expect(mistakeInputFor(card('reorder'), reorder).prompt).toBe('Then I sat on the sofa.');
  });
});
