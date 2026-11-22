import { describe, expect, it } from 'vitest';
import { checkAnswer, checkMeaning, checkVocab, diffAnswer, splitHint, suggestedGrade } from './check';

const bad = (segs: { text: string; ok: boolean }[]) => segs.filter((s) => !s.ok).map((s) => s.text.trim());

describe('checkAnswer: alternatives', () => {
  const answer = 'Igår arbetade jag i butiken. // Jag arbetade i butiken igår.';

  it('accepts any alternative separated by //', () => {
    expect(checkAnswer('Igår arbetade jag i butiken.', answer).verdict).toBe('correct');
    const second = checkAnswer('Jag arbetade i butiken igår.', answer);
    expect(second.verdict).toBe('correct');
    expect(second.expected).toBe('Jag arbetade i butiken igår.');
  });

  it('ignores punctuation, extra spaces and the case of the first letter', () => {
    expect(checkAnswer('  igår   arbetade jag i butiken ', answer).verdict).toBe('correct');
    expect(checkAnswer('Läste du boken', 'Läste du boken?').verdict).toBe('correct');
  });

  it('rejects a wrong word order and diffs against the nearest alternative', () => {
    const r = checkAnswer('Igår jag arbetade i butiken.', answer);
    expect(r.verdict).toBe('wrong');
    expect(r.expected).toBe('Igår arbetade jag i butiken.');
    expect(r.typedDiff.some((s) => !s.ok)).toBe(true);
  });

  it('treats an empty answer as wrong', () => {
    expect(checkAnswer('   ', answer).verdict).toBe('wrong');
  });
});

describe('checkAnswer: å ä ö', () => {
  it('accepts a for å with a gentle warning', () => {
    const r = checkAnswer('Igar arbetade jag i butiken.', 'Igår arbetade jag i butiken.');
    expect(r.verdict).toBe('close');
    expect(r.message).toBe('Close, watch the å.');
  });

  it('names every letter that was missed', () => {
    const r = checkAnswer('Jag alskar min svarmor.', 'Jag älskar min svärmor.');
    expect(r.verdict).toBe('close');
    expect(r.message).toBe('Close, watch the ä.');
    expect(checkAnswer('Forra aret kopte vi', 'Förra året köpte vi').message).toBe('Close, watch the å and ö.');
    expect(checkAnswer('ata, at, ol', 'äta, åt, öl').message).toBe('Close, watch the å, ä and ö.');
  });

  it('marks the misspelled words in the diff', () => {
    const r = checkAnswer('Jag alskar min svarmor.', 'Jag älskar min svärmor.');
    expect(bad(r.typedDiff)).toEqual(['alskar', 'svarmor.']);
    expect(bad(r.expectedDiff)).toEqual(['älskar', 'svärmor.']);
  });

  it('still fails when more than the dots are wrong', () => {
    expect(checkAnswer('Igar arbetar jag', 'Igår arbetade jag').verdict).toBe('wrong');
  });

  it('works across alternatives', () => {
    const r = checkAnswer('Forra veckan stadade hon', 'Förra veckan städade hon. // Hon städade förra veckan.');
    expect(r.verdict).toBe('close');
    expect(r.expected).toBe('Förra veckan städade hon.');
  });

  it('does not accept the wrong Swedish letter', () => {
    expect(checkAnswer('köpta', 'köpte').verdict).toBe('wrong');
    expect(checkAnswer('kopte', 'köpte').verdict).toBe('close');
    expect(checkAnswer('käpte', 'köpte').verdict).toBe('wrong');
  });
});

describe('checkAnswer: capitals', () => {
  it('warns about capitals in the middle of a sentence', () => {
    const r = checkAnswer('Jag Lagade middag och Vi åt.', 'Jag lagade middag och vi åt.');
    expect(r.verdict).toBe('close');
    expect(r.message).toMatch(/capital/);
    expect(bad(r.typedDiff)).toEqual(['Lagade', 'Vi']);
  });
  it('warns when a name is not capitalized', () => {
    expect(checkAnswer('vi bodde i denver', 'Vi bodde i Denver.').verdict).toBe('close');
  });
});

describe('fix-the-error cards', () => {
  it('fails when the mistake is typed back unchanged', () => {
    expect(checkAnswer('Jag kan pratar svenska.', 'Jag kan prata svenska.').verdict).toBe('wrong');
    expect(checkAnswer('Jag kan prata svenska', 'Jag kan prata svenska.').verdict).toBe('correct');
  });
  it('diff of the original against the fix shows exactly what changed', () => {
    const d = diffAnswer('Jag lär mig svenska så jag kan prata.', 'Jag lär mig svenska så att jag kan prata.');
    expect(bad(d.expected)).toEqual(['att']);
    expect(bad(d.typed)).toEqual([]);
    const e = diffAnswer('Jag har en vän som han bor i Sverige.', 'Jag har en vän som bor i Sverige.');
    expect(bad(e.typed)).toEqual(['han']);
  });
  it('splits a trailing hint off the prompt', () => {
    expect(splitHint('Igår arbetar jag. (yesterday)')).toEqual({ text: 'Igår arbetar jag.', hint: 'yesterday' });
    expect(splitHint('Vi städa igår.')).toEqual({ text: 'Vi städa igår.', hint: null });
  });
});

describe('reorder cards', () => {
  const answer = 'I lördags lagade vi middag. // Vi lagade middag i lördags.';
  const build = (...chips: string[]) => checkAnswer(chips.join(' '), answer);
  it('accepts either valid order built from the chips', () => {
    expect(build('i lördags', 'lagade', 'vi', 'middag').verdict).toBe('correct');
    expect(build('vi', 'lagade', 'middag', 'i lördags').verdict).toBe('correct');
  });
  it('rejects an order that is not listed', () => {
    expect(build('i lördags', 'vi', 'lagade', 'middag').verdict).toBe('wrong');
  });
  it('handles a question', () => {
    expect(checkAnswer(['läste', 'du', 'boken'].join(' '), 'Läste du boken?').verdict).toBe('correct');
    expect(checkAnswer(['du', 'läste', 'boken'].join(' '), 'Läste du boken?').verdict).toBe('wrong');
  });
});

describe('single words', () => {
  it('diffs letter by letter', () => {
    const r = checkAnswer('lysnade', 'lyssnade');
    expect(r.verdict).toBe('wrong');
    expect(r.expectedDiff.filter((s) => !s.ok).map((s) => s.text)).toEqual(['s']);
  });
  it('accepts the right article and flags the wrong one', () => {
    const hus = { swedish: 'hus', noun: { gender: 'ett' as const, definite: 'huset', plural: 'hus' }, verb: null };
    expect(checkVocab('hus', hus).verdict).toBe('correct');
    expect(checkVocab('ett hus', hus).verdict).toBe('correct');
    const wrong = checkVocab('en hus', hus);
    expect(wrong.verdict).toBe('close');
    expect(wrong.message).toBe('Right word, but it is “ett hus”.');
    expect(checkVocab('Hus', hus).verdict).toBe('correct');
  });
  it('accepts "att" before a verb and is forgiving about å ä ö', () => {
    const ata = { swedish: 'äta', noun: null, verb: { infinitive: 'äta', present: 'äter', past: 'åt', supine: 'ätit' } };
    expect(checkVocab('att äta', ata).verdict).toBe('correct');
    expect(checkVocab('ata', ata).message).toBe('Close, watch the ä.');
  });
  it('keeps multi-word entries that start with en/ett intact', () => {
    expect(checkVocab('i morse', { swedish: 'i morse', noun: null, verb: null }).verdict).toBe('correct');
  });
});

describe('meanings (listening cards)', () => {
  it('accepts any listed meaning', () => {
    expect(checkMeaning('hi', 'hello, hi').verdict).toBe('correct');
    expect(checkMeaning('Eat', 'to eat').verdict).toBe('correct');
    expect(checkMeaning('live', 'to live (reside)').verdict).toBe('correct');
    expect(checkMeaning('last weekend', 'this weekend / last weekend').verdict).toBe('correct');
    expect(checkMeaning('goodbye', 'hello, hi').verdict).toBe('wrong');
    expect(checkMeaning('', 'hello').verdict).toBe('wrong');
  });
});

it('suggests Good, Hard or Again', () => {
  expect([suggestedGrade('correct'), suggestedGrade('close'), suggestedGrade('wrong')]).toEqual([3, 2, 1]);
});

describe('time words written as one word or two', () => {
  const pairs: [string, string][] = [
    ['igår', 'i går'],
    ['idag', 'i dag'],
    ['imorgon', 'i morgon'],
    ['ikväll', 'i kväll'],
    ['igår kväll', 'i går kväll'],
  ];
  it.each(pairs)('%s and %s are the same answer, both ways', (one, two) => {
    for (const [typed, answer] of [
      [one, two],
      [two, one],
    ]) {
      const r = checkAnswer(typed, answer);
      expect(r).toMatchObject({ verdict: 'correct', message: null });
      expect(r.typedDiff).toEqual([{ text: typed, ok: true }]);
      expect(r.expectedDiff.every((s) => s.ok)).toBe(true);
    }
  });
  it.each(pairs)('%s inside a sentence, both ways', (one, two) => {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    for (const [a, b] of [
      [one, two],
      [two, one],
    ]) {
      expect(checkAnswer(`${cap(a)} ringde jag henne.`, `${cap(b)} ringde jag henne.`)).toMatchObject({ verdict: 'correct', message: null });
      expect(checkAnswer(`Jag ringde henne ${a}`, `Jag ringde henne ${b}.`).verdict).toBe('correct');
    }
  });
  it('a real mistake next to the time word is still marked, and the time word is not', () => {
    const r = checkAnswer('Igår läsade jag en bok.', 'I går läste jag en bok.');
    expect(r.verdict).toBe('wrong');
    expect(r.typedDiff.filter((s) => !s.ok).map((s) => s.text.trim())).toEqual(['läsade']);
    expect(r.expectedDiff.filter((s) => !s.ok).map((s) => s.text.trim())).toEqual(['läste']);
    // What I typed is shown as I typed it.
    expect(r.typedDiff.map((s) => s.text).join('')).toBe('Igår läsade jag en bok.');
    const back = checkAnswer('I går läsade jag en bok.', 'Igår läste jag en bok.');
    expect(back.typedDiff.filter((s) => !s.ok).map((s) => s.text.trim())).toEqual(['läsade']);
  });
  it('picks the nearer alternative across the two spellings', () => {
    expect(checkAnswer('Jag arbetade i butiken igår', 'I går arbetade jag i butiken. // Jag arbetade i butiken i går.').verdict).toBe('correct');
  });
  it('still wants the å, and does not invent "imorse"', () => {
    expect(checkAnswer('igar', 'i går')).toMatchObject({ verdict: 'close', message: 'Close, watch the å.' });
    expect(checkAnswer('imorse', 'i morse').verdict).toBe('wrong');
    expect(checkVocab('igår', { swedish: 'i går', noun: null, verb: null }).verdict).toBe('correct');
  });
});
