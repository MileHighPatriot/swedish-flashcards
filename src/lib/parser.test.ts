import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hintForHeading, parseLesson, parseLine, splitAlternatives, splitChunks, splitFields } from './parser';

const vocab = (line: string) => {
  const r = parseLine(line);
  expect(r.error).toBeNull();
  return r.draft!;
};

describe('vocab lines', () => {
  it('parses the documented format', () => {
    const d = vocab('hund | dog | en hund, hundar | Hunden springer i parken. = The dog runs in the park.');
    expect(d.kind).toBe('vocab');
    expect(d.swedish).toBe('hund');
    expect(d.english).toBe('dog');
    expect(d.pos).toBe('noun');
    expect(d.noun).toEqual({ gender: 'en', definite: '', plural: 'hundar' });
    expect(d.exampleSv).toBe('Hunden springer i parken.');
    expect(d.exampleEn).toBe('The dog runs in the park.');
  });

  it('reads definite and plural when both are given', () => {
    expect(vocab('hus | house | ett hus, huset, hus').noun).toEqual({ gender: 'ett', definite: 'huset', plural: 'hus' });
  });

  it('takes the article from the Swedish field', () => {
    const d = vocab('ett äpple | apple | äpplet, äpplen');
    expect(d.swedish).toBe('äpple');
    expect(d.noun).toEqual({ gender: 'ett', definite: 'äpplet', plural: 'äpplen' });
    expect(vocab('bok (en) | book').noun?.gender).toBe('en');
  });

  it('reads verb forms: present, past (and supine)', () => {
    const d = vocab('förstå | understand | förstår, förstod | Jag förstår lite svenska. = I understand a little Swedish. | vocabulary, my-mistake');
    expect(d.pos).toBe('verb');
    expect(d.verb).toEqual({ infinitive: 'förstå', present: 'förstår', past: 'förstod', supine: '' });
    expect(d.tags).toEqual(['vocabulary', 'my-mistake']);
    expect(vocab('äta | to eat | äter, åt, ätit').verb).toEqual({ infinitive: 'äta', present: 'äter', past: 'åt', supine: 'ätit' });
    expect(vocab('att äta | eat | äta, äter, åt, ätit').verb?.supine).toBe('ätit');
  });

  it('reads adjective forms', () => {
    const d = vocab('stor | big | stor, stort, stora');
    expect(d.pos).toBe('adjective');
    expect(d.adjective).toEqual({ common: 'stor', neuter: 'stort', plural: 'stora' });
  });

  it('works with a blank forms field and a blank example', () => {
    const d = vocab('gå | go, walk | går, gick | | irregular, lesson-03');
    expect(d.english).toBe('go, walk');
    expect(d.verb?.past).toBe('gick');
    expect(d.exampleSv).toBe('');
    expect(d.tags).toEqual(['irregular', 'lesson-03']);
    const t = vocab('igår | yesterday | | Igår arbetade jag. = Yesterday I worked. | time-words');
    expect(t.exampleSv).toBe('Igår arbetade jag.');
    expect(t.noun).toBeNull();
  });

  it('keeps a remark without "=" as a note, and marks multi-word entries as phrases', () => {
    const d = vocab('Vad gjorde du igår? | What did you do yesterday? | | Learn as a ready-made question. | phrases, conversation');
    expect(d.notes).toBe('Learn as a ready-made question.');
    expect(d.exampleSv).toBe('');
    expect(d.pos).toBe('phrase');
  });

  it('keeps å, ä, ö and tags like -te exactly', () => {
    const d = vocab('köpa | buy | köper, köpte | | verbs, -te, lesson-02');
    expect(d.swedish).toBe('köpa');
    expect(d.tags).toEqual(['verbs', '-te', 'lesson-02']);
  });
});

describe('messy input', () => {
  it('accepts tabs, dashes, equals, colons and commas', () => {
    expect(splitFields('hund\tdog\ten hund, hundar')).toEqual(['hund', 'dog', 'en hund, hundar']);
    expect(vocab('hund - dog').english).toBe('dog');
    expect(vocab('hund – dog – en hund, hundar').noun?.plural).toBe('hundar');
    expect(vocab('hund = dog').swedish).toBe('hund');
    expect(vocab('hund: dog').english).toBe('dog');
    expect(vocab('hund, dog').english).toBe('dog');
  });

  it('strips bullets, numbering, bold and table pipes', () => {
    expect(vocab('- hund | dog').swedish).toBe('hund');
    expect(vocab('3. hund | dog').swedish).toBe('hund');
    expect(vocab('* **hund** | dog').swedish).toBe('hund');
    expect(vocab('| hund | dog | en hund, hundar |').noun?.gender).toBe('en');
  });

  it('skips blank lines, comments, table furniture and code fences', () => {
    const r = parseLesson(['# Lesson 7', '', '| Swedish | English |', '|---|---|', '| hund | dog |', '```', '---'].join('\n'));
    expect(r.count).toBe(1);
    expect(r.errors).toHaveLength(0);
  });

  it('reports lines it cannot parse, with the line number', () => {
    const r = parseLesson('hund | dog\njust-one-word\nkatt | cat');
    expect(r.count).toBe(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(2);
    expect(r.errors[0].error).toMatch(/Swedish/);
  });
});

describe('grammar lines', () => {
  it('parses type | prompt | answer | explanation | tags', () => {
    const d = parseLine('fix | Jag kan pratar svenska. | Jag kan prata svenska. | Infinitive after a modal. | my-mistake, modals').draft!;
    expect(d.kind).toBe('fix');
    expect(d.grammar).toEqual({
      prompt: 'Jag kan pratar svenska.',
      answer: 'Jag kan prata svenska.',
      explanation: 'Infinitive after a modal.',
      topic: null,
    });
    expect(d.tags).toEqual(['my-mistake', 'modals']);
  });

  it('keeps // alternatives and / chunks intact', () => {
    const d = parseLine('reorder | arbetade / jag / igår / i butiken | Igår arbetade jag i butiken. // Jag arbetade i butiken igår. | Verb second. | word-order').draft!;
    expect(splitChunks(d.grammar!.prompt)).toEqual(['arbetade', 'jag', 'igår', 'i butiken']);
    expect(splitAlternatives(d.grammar!.answer)).toEqual(['Igår arbetade jag i butiken.', 'Jag arbetade i butiken igår.']);
  });

  it('uses the section heading when a line has no type keyword', () => {
    const r = parseLesson('### Translate\nDid you read the book? | Läste du boken? | Question order. | lesson-02');
    expect(r.sections[0].items[0].draft?.kind).toBe('translate');
    expect(r.sections[0].items[0].draft?.grammar?.answer).toBe('Läste du boken?');
  });

  it('needs a prompt and an answer', () => {
    expect(parseLine('rule | Only a prompt | ').error).toMatch(/prompt and an answer/);
  });
});

describe('sections', () => {
  it('recognises the lesson template headings', () => {
    expect(hintForHeading('Vocab')).toBe('vocab');
    expect(hintForHeading('Phrases')).toBe('phrases');
    expect(hintForHeading('Grammar rules')).toBe('rule');
    expect(hintForHeading('Fix the error')).toBe('fix');
    expect(hintForHeading('Reorder')).toBe('reorder');
    expect(hintForHeading('Translate')).toBe('translate');
    expect(hintForHeading('Grammar – Past tense & word order')).toBeNull();
  });

  it('parses a whole lesson block at once', () => {
    const r = parseLesson(
      [
        '### Vocab',
        'gå | go, walk | går, gick | | irregular',
        '### Phrases',
        'Vad bra! | How nice!',
        '### Grammar rules',
        'rule | What is the past of gå? | gick | Irregular. | irregular',
        '### Fix the error',
        'fix | gåt | gick | Irregular past of gå. | my-mistake',
        '### Reorder',
        'reorder | gick / jag / igår | Igår gick jag. // Jag gick igår. | Verb second. | word-order',
        '### Translate',
        'translate | I went. | Jag gick. | | irregular',
      ].join('\n'),
    );
    expect(r.errors).toHaveLength(0);
    expect(r.sections.map((s) => [s.hint, s.items[0].draft?.kind])).toEqual([
      ['vocab', 'vocab'],
      ['phrases', 'vocab'],
      ['rule', 'rule'],
      ['fix', 'fix'],
      ['reorder', 'reorder'],
      ['translate', 'translate'],
    ]);
  });
});

describe('starter files', () => {
  for (const file of ['grammar-lessons-01-02.txt', 'lessons-01-02-extras.txt']) {
    it(`${file} parses with no errors`, () => {
      const r = parseLesson(readFileSync(new URL(`../../seed/${file}`, import.meta.url), 'utf8'));
      expect(r.errors.map((e) => `${e.line}: ${e.raw}`)).toEqual([]);
      expect(r.count).toBeGreaterThan(50);
    });
  }
});

describe('README', () => {
  it('the example lines in the lesson template parse cleanly', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    const blocks = [...readme.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
    const example = blocks.find((b) => b.startsWith('hund | dog'))!;
    const r = parseLesson(example);
    expect(r.errors).toEqual([]);
    expect(r.sections.flatMap((s) => s.items.map((i) => i.draft!.kind))).toEqual(['vocab', 'vocab', 'fix', 'reorder']);
    expect(r.sections[0].items[0].draft!.noun).toEqual({ gender: 'en', definite: 'hunden', plural: 'hundar' });
    // the headings in the template are the ones the parser understands
    const template = blocks.find((b) => b.includes('### Vocab'))!;
    expect([...template.matchAll(/^### (.+)$/gm)].map((m) => hintForHeading(m[1]))).toEqual(['vocab', 'phrases', 'rule', 'fix', 'reorder', 'translate']);
  });
});
