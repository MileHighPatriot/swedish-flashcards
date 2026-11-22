import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import block from './__fixtures__/flashcard-block-assumed.txt?raw';
import fixOnly from './__fixtures__/fix-only-block.txt?raw';
import lesson2 from './__fixtures__/lesson2-excerpt.txt?raw';
import lesson4 from './__fixtures__/lesson4-excerpt.txt?raw';
import lesson5 from './__fixtures__/lesson5-excerpt.txt?raw';
import { db } from '../db/db';
import { listGrammarPages, listLessons, listMistakeItems, listNotes, listTexts } from '../db/repo';
import { MISTAKES_DECK, applyPlan, buildPlan, groupLesson } from './importer';
import { parseLessonDoc } from './lessonDoc';
import { buildLessonImport, isFixOnly, lessonTags, looksLikePrintable, mistakesFromFixes, needsToGroup } from './lessonImport';
import { saveFixMistakes, saveLessonExtras } from './lessonSave';
import { hasSections, parseLesson, readLessonLine } from './parser';
import { parseText } from './texts';

const opts = (n: number | null) => ({ lessonNumber: n, lessonName: '', extraTags: lessonTags(n), cardTypes: ['basic' as const, 'reverse' as const] });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('the flashcard block (assumed format)', () => {
  const parsed = parseLesson(block);

  it('is recognised as a block, with the lesson read from its title line', () => {
    expect(hasSections(block)).toBe(true);
    expect(parsed.lessonNumber).toBe(5);
    expect(parsed.lessonName).toBe('Modals, pronouns and review');
    expect(readLessonLine('Lesson 6')).toEqual({ number: 6, name: '' });
    expect(readLessonLine('**Swedish Lesson 12 (Day 12)**')).toEqual({ number: 12, name: '' });
    expect(readLessonLine('Lesson 6: Negation')).toEqual({ number: 6, name: 'Negation' });
    expect(readLessonLine('kunna | can')).toBeNull();
  });

  it('reads every section through the fence and the heading variants', () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections.map((s) => [s.heading, s.hint, s.items.length])).toEqual([
      ['Vocabulary', 'vocab', 3],
      ['Phrases', 'phrases', 1],
      ['Grammar', 'rule', 1],
      ['Fix the errors', 'fix', 1],
      ['Reorder the words', 'reorder', 1],
      ['TRANSLATION', 'translate', 1],
    ]);
    expect(parsed.count).toBe(8);
    // The line with no tags column still parses, with its example.
    const help = parsed.sections[0].items[1].draft!;
    expect(help).toMatchObject({ swedish: 'hjälpa', tags: [], exampleSv: 'Kan du hjälpa mig?', verb: { present: 'hjälper', past: 'hjälpte', supine: 'hjälpt' } });
  });

  it('lists the chat text around the block as skipped, not as errors', () => {
    expect(parsed.skipped!.map((s) => s.raw)).toEqual(['Here is your flashcard block for Lesson 5. Paste it into the app.', 'Let me know when you have done the worksheet and I will mark it.']);
    expect(parsed.skipped![0].line).toBe(1);
  });

  it('tags every card with its lesson and its plan week', async () => {
    expect(lessonTags(5)).toEqual(['lesson-05', 'week-00']);
    expect(lessonTags(6)).toEqual(['lesson-06', 'week-01']);
    expect(lessonTags(16)).toEqual(['lesson-16', 'week-04']);
    expect(lessonTags(null)).toEqual([]);
    const moved = parseLesson(block.replace('Lesson 5 –', 'Lesson 9 –'));
    const r = await applyPlan(await buildPlan(groupLesson(moved, moved.lessonNumber!, moved.lessonName!)), opts(9));
    expect(r.added).toBe(8);
    const notes = await listNotes();
    expect(notes.every((n) => n.tags.includes('lesson-09') && n.tags.includes('week-02'))).toBe(true);
    expect(notes.find((n) => n.swedish === 'kunna')!.tags).toEqual(['verbs', 'modals', 'lesson-09', 'week-02']);
  });

  it('a plain list of card lines with no headings still works as before', () => {
    const plain = parseLesson('hund | dog\nNot a card line at all\nkatt - cat');
    expect(plain.count).toBe(2);
    expect(plain.skipped).toEqual([]);
    expect(plain.errors.length).toBe(1);
  });
});

describe('a fix-only block from a marked worksheet', () => {
  it('goes into the mistakes deck and onto My mistakes, once', async () => {
    const parsed = parseLesson(fixOnly);
    expect(isFixOnly(parsed)).toBe(true);
    expect(isFixOnly(parseLesson(block))).toBe(false);
    expect(parsed.skipped!.length).toBe(1);
    const plan = await buildPlan(groupLesson(parsed, null, ''));
    expect(plan.map((g) => g.deck.name)).toEqual([MISTAKES_DECK]);
    await applyPlan(plan, opts(null));
    expect(await saveFixMistakes(mistakesFromFixes(plan))).toBe(3);
    const items = await listMistakeItems();
    expect(items.find((i) => i.typed === 'Sedan vi tog tåget hem.')).toMatchObject({
      prompt: 'Fix this sentence: Sedan vi tog tåget hem.',
      correct: 'Sedan tog vi tåget hem.',
      reason: 'The verb takes seat 2 after sedan.',
      source: 'marked-worksheet',
      timesWrong: 1,
      tags: ['my-mistake', 'verb-second', 'word-order'],
    });
    // Pasting the same block again doubles nothing.
    const again = await buildPlan(groupLesson(parsed, null, ''));
    expect(again[0].rows.every((r) => r.duplicate?.sameDeck)).toBe(true);
    expect(await saveFixMistakes(mistakesFromFixes(again))).toBe(0);
    expect((await listMistakeItems()).length).toBe(3);
    // A skipped row adds no item.
    expect(mistakesFromFixes([{ ...plan[0], rows: plan[0].rows.map((r) => ({ ...r, action: 'skip' as const })) }])).toEqual([]);
  });
});

describe('the lesson printable (fallback)', () => {
  it('is only used when there are no sections', () => {
    expect(hasSections(lesson4)).toBe(false);
    expect(looksLikePrintable(lesson4)).toBe(true);
    expect(looksLikePrintable(lesson5)).toBe(true);
    expect(looksLikePrintable(lesson2)).toBe(true);
    expect(looksLikePrintable('hund | dog\nkatt | cat')).toBe(false);
  });

  it('lesson 4: words, my dialogue lines as phrases, texts with questions, items that need an answer', () => {
    const imp = buildLessonImport(parseLessonDoc(lesson4));
    expect(imp.number).toBe(4);
    const byDeck = Object.fromEntries(imp.groups.map((g) => [g.deck.name, g.items.map((i) => i.draft)]));
    const title = 'Lesson 04 – Mixed past tense, seven more irregular verbs, and the Week 1 checkpoint';
    expect(byDeck[title].map((d) => [d.swedish, d.verb?.past, d.verb?.supine])).toEqual([
      ['skriva', 'skrev', 'skrivit'],
      ['sitta', 'satt', 'suttit'],
    ]);
    expect(byDeck[`Phrases – ${title}`].map((d) => [d.swedish, d.english])).toEqual([['Jag skrev en lista och köpte mat i affären.', 'I wrote a list and bought food at the store.']]);
    expect(imp.texts.map((t) => [t.kind, t.title])).toEqual([
      ['story', 'Min lördag'],
      ['dialogue', 'See it in real life'],
    ]);
    const story = parseText(imp.texts[0].body, 'x');
    expect(story).toMatchObject({ title: 'Min lördag', lesson: 4 });
    expect(story.lines[2]).toEqual({ speaker: '', sv: 'Efter middagen blev jag trött och såg en film hemma.', en: 'After dinner I got tired and watched a movie at home.' });
    // "Answer in Swedish" becomes a question on the story, with the answer left for me.
    expect(story.questions).toEqual([{ question: 'När vaknade jag?', answers: [], line: null }]);
    const talk = parseText(imp.texts[1].body, 'y');
    expect(talk.lines.map((l) => l.speaker)).toEqual(['Svärmor', 'Du', 'Svärmor']);
    expect(imp.needs.map((n) => [n.kind, n.text])).toEqual([
      ['fix', 'Igår skrivde jag ett mail.'],
      ['fix', 'Hon sagde att hon var trött.'],
    ]);
    expect(imp.lesson).toMatchObject({ number: 4, week: 0 });
    expect(imp.lesson!.checklist.length).toBe(5);
    expect(imp.lesson!.speakingPrompt).toContain('Ask me in Swedish about my last weekend');
    expect(imp.lesson!.questions.map((q) => q.sv)).toContain('Vad gjorde du i lördags?');
    expect(imp.unparsed).toEqual([]);
    // Nothing from the page footer got in anywhere.
    expect(JSON.stringify(imp)).not.toContain('Swedish Plan |');
  });

  it('an item becomes a card only once it has an answer', () => {
    const imp = buildLessonImport(parseLessonDoc(lesson4));
    expect(needsToGroup(imp.needs, 4, 'x')).toEqual([]);
    const filled = imp.needs.map((n, i) => (i === 0 ? { ...n, answer: 'I går skrev jag ett mail.' } : n));
    const groups = needsToGroup(filled, 4, 'x');
    expect(groups.map((g) => [g.deck.name, g.items.length])).toEqual([[MISTAKES_DECK, 1]]);
    expect(groups[0].items[0].draft.grammar).toMatchObject({ prompt: 'Igår skrivde jag ett mail.', answer: 'I går skrev jag ett mail.' });
  });

  it('lesson 5: nouns with their article, the example column, the reading, and the report page', () => {
    const imp = buildLessonImport(parseLessonDoc(lesson5));
    const words = imp.groups[0].items.map((i) => i.draft);
    expect(words.find((d) => d.swedish === 'familj')).toMatchObject({ english: 'family', pos: 'noun', noun: { gender: 'en' } });
    expect(words.find((d) => d.swedish === 'också')).toMatchObject({ english: 'also, too', exampleSv: 'Jag vill också komma.' });
    expect(words.find((d) => d.swedish === 'arbeta')!.verb).toMatchObject({ present: 'arbetar', past: 'arbetade' });
    const reading = parseText(imp.texts.find((t) => t.kind === 'reading')!.body, 'r');
    expect(reading.title).toBe('Eriks helg');
    expect(reading.lines[2].sv).toBe('Anna måste arbeta, så Erik ska vara hemma med barnen.');
    expect(imp.reportPage!.title).toBe('Lesson 05 report');
    expect(imp.reportPage!.markdown).toContain('| Task type | Lesson 3 | Lesson 4 | What it shows |');
    expect(imp.reportPage!.markdown).toContain('| Reorder given words / fix a printed sentence | 4/5 | 3/5, 6/6 | Good |');
    expect(imp.needs.map((n) => n.text)).toEqual(['Vi borde i Denver.', 'Igår lekade barnen i parken.', 'Jag ringade henne igår.']);
  });

  it('lesson 2: check-yourself items become rule cards, and the answer key is kept', () => {
    const doc = parseLessonDoc(lesson2);
    const imp = buildLessonImport(doc, 2, 'te and de');
    const rules = imp.groups.find((g) => g.deck.category === 'grammar')!.items.map((i) => i.draft.grammar!);
    expect(rules.map((r) => [r.prompt, r.answer])).toEqual([
      ['What is the past tense of tänka?', 'tänkte, because the stem tänk ends in k'],
      ['What is the past tense of leva?', 'levde, because the stem lev ends in v'],
      ['How do you ask Did you read the book?', 'Läste du boken?'],
    ]);
    expect(doc.answerKey.A.length).toBe(10);
  });

  it('saving twice updates the lesson, the texts and the report in place', async () => {
    const imp = buildLessonImport(parseLessonDoc(lesson5));
    await applyPlan(await buildPlan(imp.groups), opts(5));
    expect(await saveLessonExtras(imp, imp.texts)).toEqual({ texts: 2, lesson: true, report: true });
    const count = (await listNotes()).length;
    // The second time every card is flagged as already there…
    const again = await buildPlan(imp.groups);
    expect(again.every((g) => g.rows.every((r) => r.duplicate?.sameDeck && r.action === 'merge'))).toBe(true);
    await applyPlan(again, opts(5));
    await saveLessonExtras({ ...imp, lesson: { ...imp.lesson!, checklist: ['changed'] } }, imp.texts);
    expect((await listNotes()).length).toBe(count);
    // …and the rest is upserted.
    const lessons = await listLessons();
    expect(lessons.map((l) => [l.id, l.number, l.week, l.checklist])).toEqual([['lesson:5', 5, 0, ['changed']]]);
    expect((await listTexts()).map((t) => t.title).sort()).toEqual(['Lesson 5: Eriks helg', 'Lesson 5: at a café']);
    expect((await listGrammarPages()).filter((p) => p.slug === 'lesson-05-report').length).toBe(1);
    expect((await listNotes()).every((n) => n.tags.includes('lesson-05') && n.tags.includes('week-00'))).toBe(true);
  });
});

describe('journal corrections', () => {
  it('become My mistakes items as well as fix cards, once', async () => {
    const { fixLines } = await import('../practice/Journal');
    const reply = ['Here is the corrected entry.', '', '### Fix the error', 'fix | Igår jag gick hem. | I går gick jag hem. | Verb in seat 2. | my-mistake, verb-second', 'Well done on the past tense!'].join('\n');
    const plan = await buildPlan(groupLesson(fixLines(reply), null, ''));
    await applyPlan(plan, opts(null));
    expect(await saveFixMistakes(mistakesFromFixes(plan, 'journal'))).toBe(1);
    expect(await saveFixMistakes(mistakesFromFixes(plan, 'journal'))).toBe(0);
    expect(await listMistakeItems()).toMatchObject([{ prompt: 'Fix this sentence: Igår jag gick hem.', typed: 'Igår jag gick hem.', correct: 'I går gick jag hem.', reason: 'Verb in seat 2.', source: 'journal' }]);
  });
});
