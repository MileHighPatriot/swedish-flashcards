import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import lesson2 from './__fixtures__/lesson2-excerpt.txt?raw';
import lesson4 from './__fixtures__/lesson4-excerpt.txt?raw';
import lesson5 from './__fixtures__/lesson5-excerpt.txt?raw';
import { flattenSpaces, parseLessonDoc, parseLessonDocDetailed, type LessonDoc } from './lessonDoc';

const FOOTER = /^Swedish Plan\s*\|.*Page\s+\d+$/;

/** Every line with text is in exactly one of: a structure, skipped, unparsed. */
function expectAccounted(text: string) {
  const { doc, consumed, ignored } = parseLessonDocDetailed(text);
  const count = new Map<number, number>();
  const bump = (n: number) => count.set(n, (count.get(n) ?? 0) + 1);
  consumed.forEach(bump);
  doc.skipped.forEach((s) => bump(s.line));
  doc.unparsed.forEach((s) => bump(s.line));
  text.split('\n').forEach((raw, i) => {
    const t = raw.replace(/\f/g, '').trim();
    if (!t || FOOTER.test(t)) {
      expect(ignored).toContain(i + 1);
      expect(count.get(i + 1) ?? 0, `line ${i + 1} should be ignored: ${t}`).toBe(0);
    } else expect(count.get(i + 1) ?? 0, `line ${i + 1}: ${t}`).toBe(1);
  });
}

const counts = (d: LessonDoc) => ({
  words: d.words.length,
  texts: d.texts.map((t) => `${t.kind}:${t.lines.length}`),
  checks: d.checks.length,
  items: d.items.length,
  checklist: d.checklist.length,
  questions: d.questions.length,
  skipped: d.skipped.length,
  unparsed: d.unparsed.length,
});

describe('Lesson 4 excerpt (numbered sections, Part A to H)', () => {
  const d = parseLessonDoc(lesson4);

  it('reads the header', () => {
    expect(d.number).toBe(4);
    expect(d.title).toBe('Mixed past tense, seven more irregular verbs, and the Week 1 checkpoint');
  });

  it('reads the verb table', () => {
    expect(d.words.map((w) => w.swedish)).toEqual(['skriva', 'sitta']);
    expect(d.words[0]).toMatchObject({ english: 'write', gender: null, verb: { infinitive: 'skriva', present: 'skriver', past: 'skrev', supine: 'skrivit' } });
    expect(d.words[1].verb).toEqual({ infinitive: 'sitta', present: 'sitter', past: 'satt', supine: 'suttit' });
  });

  it('reads the story and joins a wrapped English cell', () => {
    const story = d.texts.find((t) => t.kind === 'story')!;
    expect(story.title).toBe('Min lördag');
    expect(story.lines).toHaveLength(3);
    expect(story.lines[0]).toEqual({ speaker: '', sv: 'I lördags vaknade jag klockan åtta.', en: 'Last Saturday I woke up at eight.', n: null });
    expect(story.lines[2]).toEqual({ speaker: '', sv: 'Efter middagen blev jag trött och såg en film hemma.', en: 'After dinner I got tired and watched a movie at home.', n: null });
  });

  it('reads the dialogue with its speakers', () => {
    const talk = d.texts.find((t) => t.kind === 'dialogue')!;
    expect(talk.title).toBe('See it in real life');
    expect(talk.lines.map((l) => l.speaker)).toEqual(['Svärmor', 'Du', 'Svärmor']);
    expect(talk.lines[1]).toMatchObject({ sv: 'Jag skrev en lista och köpte mat i affären.', en: 'I wrote a list and bought food at the store.' });
    expect(talk.lines[2]).toMatchObject({ sv: 'Och sedan?', en: 'And then?' });
  });

  it('lists the conversation questions without the speaker', () => {
    expect(d.questions).toEqual([
      { sv: 'Vad gjorde du i lördags?', en: 'What did you do last Saturday?' },
      { sv: 'Och sedan?', en: 'And then?' },
    ]);
  });

  it('reads the worksheet items of Part F and Part G', () => {
    expect(d.items).toEqual([
      { line: 47, part: 'F', partTitle: 'Find and fix the error (write the correct sentence)', n: 1, text: 'Igår skrivde jag ett mail.', answer: '' },
      { line: 49, part: 'F', partTitle: 'Find and fix the error (write the correct sentence)', n: 2, text: 'Hon sagde att hon var trött.', answer: '' },
      { line: 53, part: 'G', partTitle: 'Answer in Swedish (use the story, one full sentence each)', n: 1, text: 'När vaknade jag?', answer: '' },
    ]);
  });

  it('reads the checklist and the speaking prompt', () => {
    expect(d.checklist).toHaveLength(5);
    expect(d.checklist[0]).toBe('Said all 7 new past forms out loud three times (skrev, satt, stod, låg, sa, blev, drack)');
    expect(d.checklist[4]).toBe('Told my wife one true story from yesterday in Swedish');
    expect(d.speakingPrompt.startsWith('I am practicing Swedish past tense mixing all patterns: -ade, -te, -de and irregular verbs (gå, äta, se, vara, ha, göra, komma,')).toBe(true);
    expect(d.speakingPrompt.endsWith('note any spelling slips. Do not correct me during the conversation.')).toBe(true);
    expect(d.speakingPrompt).toContain('like Satt du...? Drack du...? Blev du...?');
  });

  it('treats the lesson prose and the old checkpoint text as skipped, with nothing unparsed', () => {
    expect(d.unparsed).toEqual([]);
    const skipped = d.skipped.map((s) => s.raw.trim());
    expect(skipped).toContain('Week 1 checkpoint: how to use it');
    expect(skipped).toContain('Again, the third form is only for later (after har). Glance at it, but do not use it as the past.');
    expect(skipped.some((s) => s.startsWith('Name:'))).toBe(true);
    expect(skipped.some((s) => s.startsWith('Plan:'))).toBe(true);
    expect(d.report).toBeNull();
    expect(d.checks).toEqual([]);
    expect(d.answerKey).toEqual({});
    expect(d.writingTask).toBe('');
  });

  it('never lets the page footer through', () => {
    expect(JSON.stringify(parseLessonDocDetailed(lesson4).doc)).not.toMatch(/Swedish Plan|Page 1/);
  });

  it('accounts for every line', () => expectAccounted(lesson4));
});

describe('Lesson 5 excerpt (PART 1 / PART 2, lettered sections)', () => {
  const d = parseLessonDoc(lesson5);

  it('reads the header without needing the day', () => {
    expect(d.number).toBe(5);
    expect(d.title).toBe('Modal verbs, object pronouns and possessives, and a cumulative review');
    expect(parseLessonDoc(' Swedish Lesson 6\n Negation\n').number).toBe(6);
    expect(parseLessonDoc(' Swedish Lesson 6\n Negation\n').title).toBe('Negation');
  });

  it('keeps the report: paragraph, table and the wrapped row', () => {
    const r = d.report!;
    expect(r.title).toBe('Your Lesson 3 and 4 report');
    expect(r.paragraphs).toEqual([
      'I marked both worksheets. The scores below split the work by type of task, because the pattern behind them matters more than the totals.',
    ]);
    expect(r.table!.header).toEqual(['Task type', 'Lesson 3', 'Lesson 4', 'What it shows']);
    expect(r.table!.rows).toHaveLength(6);
    expect(r.table!.rows[0]).toEqual(['Put the verb in the past (verb given)', '9/10', '7/7', 'Strong']);
    expect(r.table!.rows[3]).toEqual(['Sort verbs by pattern', '6/8', '10/12', 'Good. Misses: ringa, leka, läsa']);
    expect(r.table!.rows[4]).toEqual(['Reorder given words / fix a printed sentence', '4/5', '3/5, 6/6', 'Good']);
    expect(r.table!.rows[5]).toEqual(['Translate English into Swedish', '3/6', '2/8', 'Weak']);
  });

  it('keeps numbered patterns under a report with their paragraphs', () => {
    const r = parseLessonDoc(
      [' Swedish Lesson 5', ' Topic', ' PART 1: LESSON TEXT', ' A. Your report', ' One line.', ' 1. First pattern', ' What it means', ' in two lines.', ' 2. Second pattern', ' More.', ' B. Next section', ' Prose.'].join('\n'),
    ).report!;
    expect(r.paragraphs).toEqual(['One line.']);
    expect(r.patterns).toEqual([
      { n: 1, title: 'First pattern', text: 'What it means in two lines.' },
      { n: 2, title: 'Second pattern', text: 'More.' },
    ]);
  });

  it('reads the verb bank, the double word table and the example table', () => {
    const bank = d.words.filter((w) => w.verb);
    expect(bank.map((w) => [w.verb!.infinitive, w.verb!.present, w.verb!.past, w.verb!.supine, w.english])).toEqual([
      ['arbeta', 'arbetar', 'arbetade', '', 'work'],
      ['handla', 'handlar', 'handlade', '', 'shop'],
      ['prata', 'pratar', 'pratade', '', 'talk'],
    ]);
    expect(d.words.find((w) => w.swedish === 'familj')).toMatchObject({ gender: 'en', english: 'family', verb: null });
    expect(d.words.find((w) => w.swedish === 'föräldrar')).toMatchObject({ gender: null, english: 'parents' });
    expect(d.words.find((w) => w.swedish === 'mamma')).toMatchObject({ gender: 'en', english: 'mom' });
    expect(d.words.find((w) => w.swedish === 'pappa')).toMatchObject({ gender: 'en', english: 'dad' });
    expect(d.words.find((w) => w.swedish === 'också')).toMatchObject({ english: 'also, too', exampleSv: 'Jag vill också komma.', gender: null });
    expect(d.words).toHaveLength(8);
  });

  it('reads verb forms from parentheses', () => {
    const w = parseLessonDoc([' New words', ` ${'Swedish'.padEnd(40)}English`, ` ${'hjälpa (hjälper, hjälpte)'.padEnd(40)}help`, ` ${'ett kort'.padEnd(40)}card`].join('\n')).words;
    expect(w[0]).toMatchObject({ swedish: 'hjälpa', english: 'help', verb: { infinitive: 'hjälpa', present: 'hjälper', past: 'hjälpte', supine: '' } });
    expect(w[1]).toMatchObject({ swedish: 'kort', gender: 'ett' });
  });

  it('reads the café dialogue', () => {
    const talk = d.texts.find((t) => t.kind === 'dialogue')!;
    expect(talk.title).toBe('at a café');
    expect(talk.lines.map((l) => l.speaker)).toEqual(['Expedit', 'Du', 'Expedit', 'Du']);
    expect(talk.lines[1]).toMatchObject({ sv: 'Hej! Jag skulle vilja ha en kaffe, tack.', en: 'Hi! I would like a coffee, please.' });
  });

  it('reads the reading with line numbers and joins wrapped cells', () => {
    const reading = d.texts.find((t) => t.kind === 'reading')!;
    expect(reading.title).toBe('Eriks helg');
    expect(reading.lines.map((l) => l.n)).toEqual([1, 2, 3, 4]);
    expect(reading.lines[0]).toMatchObject({ sv: 'Erik har en fru, Anna, och två barn.', en: 'Erik has a wife, Anna, and two children.' });
    expect(reading.lines[1]).toMatchObject({ sv: 'På lördag vill barnen leka i parken.', en: 'On Saturday the children want to play in the park.' });
    expect(reading.lines[2]).toMatchObject({ sv: 'Anna måste arbeta, så Erik ska vara hemma med barnen.', en: 'Anna has to work, so Erik is going to be home with the children.' });
    expect(reading.lines[3]).toMatchObject({ sv: 'Han kan inte laga middag, men han kan åka till affären och köpa mat.', en: 'He cannot make dinner, but he can go to the store and buy food.' });
  });

  it('lists the questions as sentences', () => {
    expect(d.questions).toEqual([
      { sv: 'Kan jag hjälpa dig?', en: 'Can I help you?' },
      { sv: 'Vill du ha något mer?', en: 'Do you want anything else?' },
      { sv: 'Ja, kan jag få en kanelbulle också?', en: 'Yes, can I have a cinnamon bun too?' },
    ]);
  });

  it('tells a numbered worksheet part from its numbered items', () => {
    expect(d.items.map((i) => [i.part, i.partTitle, i.n, i.text])).toEqual([
      ['4', 'Find and fix (write the correct sentence)', 1, 'Vi borde i Denver.'],
      ['4', 'Find and fix (write the correct sentence)', 2, 'Igår lekade barnen i parken.'],
      ['4', 'Find and fix (write the correct sentence)', 3, 'Jag ringade henne igår.'],
    ]);
  });

  it('handles sub-parts, the next part and a writing part', () => {
    const w = parseLessonDoc(
      [
        ' PART 2: WORKSHEET',
        ' 1. Past tense chooser',
        ' 1. arbeta ______',
        ' 2. Second part',
        ' 2D. Pick the form',
        ' 1. Jag (kan) ______ komma.',
        ' 2. Vi vill ______.',
        ' 8. Writing',
        ' Write five sentences about your weekend.',
        ' 1. ____________________',
      ].join('\n'),
    );
    expect(w.items.map((i) => [i.part, i.n])).toEqual([
      ['1', 1],
      ['2D', 1],
      ['2D', 2],
      ['8', 1],
    ]);
    expect(w.writingTask).toBe('Write five sentences about your weekend.\n1. ____________________');
  });

  it('has nothing unparsed and accounts for every line', () => {
    expect(d.unparsed).toEqual([]);
    expect(d.skipped.map((s) => s.raw.trim())).toContain('Family words (this week\'s theme)');
    expectAccounted(lesson5);
  });
});

describe('Lesson 2 excerpt (check yourself, answer key)', () => {
  const d = parseLessonDoc(lesson2);

  it('has no header to read', () => {
    expect(d.number).toBeNull();
    expect(d.title).toBe('');
  });

  it('reads the check-yourself items with their answers', () => {
    expect(d.checks).toEqual([
      { line: 3, question: 'What is the past tense of tänka?', answer: 'tänkte, because the stem tänk ends in k' },
      { line: 4, question: 'What is the past tense of leva?', answer: 'levde, because the stem lev ends in v' },
      { line: 5, question: 'How do you ask Did you read the book?', answer: 'Läste du boken?' },
    ]);
  });

  it('reads the answer key and joins its wrapped cells', () => {
    expect(d.answerKey.A).toEqual([
      'Jag köpte en bok.',
      'Hon läste tidningen.',
      'Vi reste till Sverige.',
      'Jag ringde min mamma.',
      'De hörde musik.',
      'Han körde bilen.',
      'Jag tänkte på dig.',
      'Vi bodde i Denver.',
      'Hon tyckte om pizza.',
      'Jag rökte en cigarr.',
    ]);
    expect(d.answerKey.B).toEqual(['åka: åk, k, -te, åkte. bygga: bygg, g, -de, byggde. leka: lek, k, -te, lekte. stänga: stäng, g, -de,']);
    expect(Object.keys(d.answerKey)).toEqual(['A', 'B']);
  });

  it('fills answers into the items of the matching part only', () => {
    const w = parseLessonDoc(
      [' Worksheet', ' Part A: Translate', ' 1. I bought a book.', ' 2. She read the newspaper.', ' Part B: Sort', ' 1. åka', '', lesson2.slice(lesson2.indexOf(' Answer key'))].join('\n'),
    );
    expect(w.items.map((i) => [i.part, i.n, i.answer])).toEqual([
      ['A', 1, 'Jag köpte en bok.'],
      ['A', 2, 'Hon läste tidningen.'],
      ['B', 1, ''],
    ]);
  });

  it('joins a wrapped "(answer: ...)"', () => {
    const c = parseLessonDoc([' 9. Check yourself', ' 1. What is the past tense of leva? (answer: levde, because', ' the stem lev ends in v)', ' 2. And tänka? (answer: tänkte)'].join('\n')).checks;
    expect(c.map((x) => x.answer)).toEqual(['levde, because the stem lev ends in v', 'tänkte']);
  });

  it('has nothing unparsed and accounts for every line', () => {
    expect(d.unparsed).toEqual([]);
    expect(d.skipped.map((s) => s.raw.trim())).toEqual(['Say each answer out loud.', 'Check this only after you finish.']);
    expectAccounted(lesson2);
  });
});

describe('page furniture', () => {
  it('drops footers and form feeds, and lets a table run across a page break', () => {
    const text = [
      ' 6. Read the story: Min lördag',
      ' Swedish                                                             English',
      '',
      ' I lördags vaknade jag klockan åtta.                                 Last Saturday I woke up at eight.',
      '',
      'Swedish Plan | Lesson 4 (Day 4) | Mixed past tense + Week 1 checkpoint                                                 Page 3',
      '\f Klockan sex stod jag i köket och lagade middag.                     At six I stood in the kitchen and made dinner.',
    ].join('\n');
    const d = parseLessonDoc(text);
    expect(d.texts[0].lines.map((l) => l.sv)).toEqual(['I lördags vaknade jag klockan åtta.', 'Klockan sex stod jag i köket och lagade middag.']);
    expect(JSON.stringify(d)).not.toMatch(/Swedish Plan|\\f/);
    expectAccounted(text);
  });
});

describe('a flattened copy (single spaces, as copied from Preview)', () => {
  const flat = flattenSpaces(lesson4);
  const d = parseLessonDoc(flat);

  it('does not crash and still finds what does not depend on columns', () => {
    expect(flat).not.toMatch(/ {2}/);
    expect(d.number).toBe(4);
    expect(d.title).toBe('Mixed past tense, seven more irregular verbs, and the Week 1 checkpoint');
    expect(d.checklist).toHaveLength(5);
    expect(d.speakingPrompt.endsWith('Do not correct me during the conversation.')).toBe(true);
    expect(d.items.map((i) => [i.part, i.n, i.text])).toEqual([
      ['F', 1, 'Igår skrivde jag ett mail.'],
      ['F', 2, 'Hon sagde att hon var trött.'],
      ['G', 1, 'När vaknade jag?'],
    ]);
  });

  it('lists what it cannot place instead of dropping it', () => {
    const listed = [...d.unparsed, ...d.skipped].map((s) => s.raw.trim());
    // One-word columns can still be split; sentence columns cannot.
    for (const verb of ['skriva', 'sitta']) expect(d.words.some((w) => w.swedish === verb) || listed.some((l) => l.startsWith(`${verb} `))).toBe(true);
    const unparsed = d.unparsed.map((s) => s.raw.trim());
    expect(unparsed).toContain('I lördags vaknade jag klockan åtta. Last Saturday I woke up at eight.');
    expect(unparsed).toContain('Svärmor: Och sedan? And then?');
    expect(d.texts).toEqual([]);
    expectAccounted(flat);
  });

  it('accounts for every line of the other flattened fixtures too', () => {
    expectAccounted(flattenSpaces(lesson5));
    expectAccounted(flattenSpaces(lesson2));
    expect(parseLessonDoc(flattenSpaces(lesson2)).answerKey.A).toHaveLength(10);
  });
});

// My full lesson files are not in the repo (it is public). When they are on this Mac, run the parser over them.
const FULL = [2, 3, 4, 5].map((n) => join(homedir(), 'swedish-lessons', `lesson${n}.txt`)).filter((p) => existsSync(p));

describe('full lessons in ~/swedish-lessons', () => {
  it.skipIf(FULL.length === 0)('parse without losing a line', () => {
    for (const path of FULL) {
      const text = readFileSync(path, 'utf8');
      const d = parseLessonDoc(text);
      console.log(path, counts(d));
      expect(d.number).not.toBeNull();
      expectAccounted(text);
    }
  });
});
