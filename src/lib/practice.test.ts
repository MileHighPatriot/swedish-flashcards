import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../seed/grammar-lessons-01-02.txt?raw', () => ({ default: '' }));
vi.mock('../../seed/lessons-01-02-extras.txt?raw', () => ({ default: '' }));

import { db } from '../db/db';
import { deleteJournal, listJournal, listNotes, listTexts, saveJournal, saveText } from '../db/repo';
import { applyPlan, buildPlan, groupLesson, loadBuiltInLesson, loadStarterLessons, toBuiltInLesson } from './importer';
import { dateKey, drillNouns, journalForClaude, sentencePool } from './practice';
import { BUILT_IN_TEXTS, SITUATION_CATEGORIES, SITUATIONS, buildLexicon, isDialogue, knownShare, lookup, parseText, speakersOf, splitSentences, tokenize } from './texts';
import { drillVerbs } from './verbdrill';
import { fixLines } from '../practice/Journal';

const seed = (f: string) => readFileSync(new URL(`../../seed/${f}`, import.meta.url), 'utf8');

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

async function loadAll() {
  await loadStarterLessons([seed('grammar-lessons-01-02.txt'), seed('lessons-01-02-extras.txt')]);
  await loadBuiltInLesson(toBuiltInLesson('lesson-03-irregular-verbs.txt', seed('lesson-03-irregular-verbs.txt')));
  return listNotes();
}

describe('built-in texts', () => {
  it('has a story for each lesson, and a dialogue where I have one', () => {
    expect(BUILT_IN_TEXTS.map((t) => [t.lesson, isDialogue(t)])).toEqual([
      [1, true],
      [1, false],
      [2, true],
      [2, false],
      [3, true],
      [3, false],
      // Lesson 4 has its story; its dialogue was never pasted.
      [4, false],
      [5, true],
      [5, false],
    ]);
    expect(speakersOf(BUILT_IN_TEXTS.find((t) => t.id === 'seed:05-dialogue-pa-ett-kafe')!)).toEqual(['Expedit', 'Du']);
    const d3 = BUILT_IN_TEXTS.find((t) => t.id === 'seed:03-dialogue-hur-var-din-dag')!;
    expect(d3.title).toBe('Hur var din dag?');
    expect(speakersOf(d3)).toEqual(['Svärmor', 'Du']);
    expect(d3.lines).toHaveLength(11);
    expect(d3.lines[1]).toEqual({ speaker: 'Du', sv: 'Den var bra! Jag gick till jobbet och jag såg en gammal vän.', en: 'It was good! I went to work and I saw an old friend.' });
    for (const t of BUILT_IN_TEXTS) for (const l of t.lines) expect(l.sv && l.en, t.id).toBeTruthy();
  });
});

describe('parseText', () => {
  it('reads piped lines, speaker lines and plain paragraphs', () => {
    const t = parseText('# Lesson 04 – På kaféet\n# a comment\nAnna | Hej! | Hi!\nJag heter Bo. | My name is Bo.\nEva: Hur mår du?\nDet är kallt idag. Vi går hem! Kommer du?', 'x');
    expect(t).toMatchObject({ title: 'På kaféet', lesson: 4 });
    expect(t.lines).toEqual([
      { speaker: 'Anna', sv: 'Hej!', en: 'Hi!' },
      { speaker: '', sv: 'Jag heter Bo.', en: 'My name is Bo.' },
      { speaker: 'Eva', sv: 'Hur mår du?', en: '' },
      { speaker: '', sv: 'Det är kallt idag.', en: '' },
      { speaker: '', sv: 'Vi går hem!', en: '' },
      { speaker: '', sv: 'Kommer du?', en: '' },
    ]);
    expect(parseText('Hej då', 'y', false, 'Mine').title).toBe('Mine');
    expect(splitSentences('Klockan är 9.30 nu. Kom!')).toEqual(['Klockan är 9.30 nu.', 'Kom!']);
  });

  it('tokenizes Swedish words and keeps the punctuation', () => {
    const toks = tokenize('Åh, vad fint! Tog du den med hem?');
    expect(toks.filter((t) => t.word).map((t) => t.text)).toEqual(['Åh', 'vad', 'fint', 'Tog', 'du', 'den', 'med', 'hem']);
    expect(toks.map((t) => t.text).join('')).toBe('Åh, vad fint! Tog du den med hem?');
  });
});

describe('word lookup', () => {
  it('finds a word through any of its forms', async () => {
    const lex = buildLexicon(await loadAll());
    expect(lookup(lex, 'Gick')).toMatchObject({ form: 'past tense of gå', note: { swedish: 'gå' } });
    expect(lookup(lex, 'presenten')).toMatchObject({ form: 'the definite form of present' });
    expect(lookup(lex, 'gamla')).toMatchObject({ form: 'plural form of gammal' });
    expect(lookup(lex, 'hemma')).toMatchObject({ form: '', note: { english: 'at home' } });
    // "var" is the past of vara; the word itself would win if it had its own card.
    expect(lookup(lex, 'var')?.form).toBe('past tense of vara');
    expect(lookup(lex, 'kanelbullar')).toBeNull();
    const story = BUILT_IN_TEXTS.find((t) => t.id === 'seed:03-story-igar-gick-jag-till-jobbet')!;
    expect(knownShare(story, lex)).toBeGreaterThan(0.4);
    expect(knownShare(story, lex)).toBeLessThan(1);
  });
});

describe('practice pools', () => {
  it('gathers each sentence once, with its meaning, and leaves single words out', async () => {
    const notes = await loadAll();
    const pool = sentencePool(notes);
    expect(pool.length).toBeGreaterThan(100);
    expect(new Set(pool.map((s) => s.sv.toLowerCase())).size).toBe(pool.length);
    expect(pool.every((s) => /\s/.test(s.sv))).toBe(true);
    expect(pool.find((s) => s.sv === 'Tog du bussen?')).toMatchObject({ en: 'Did you take the bus?', lesson: 'lesson-03' });
    expect(pool.find((s) => s.sv === 'Hur var din dag?')?.en).toBe('How was your day?');
    // Answers of reorder cards carry the English from the prompt's brackets.
    expect(pool.find((s) => s.sv === 'Jag kom hem klockan sex.')?.en).toBeTruthy();
    // Locked or suspended cards stay out.
    const one = notes.find((n) => n.exampleSv === 'Jag tog en dusch.')!;
    expect(sentencePool(notes, new Set([one.id])).some((s) => s.sv === 'Jag tog en dusch.')).toBe(false);
  });

  it('lists nouns with their gender and verbs with all their forms', async () => {
    const notes = await loadAll();
    const nouns = drillNouns(notes);
    expect(nouns.find((n) => n.word === 'frukost')).toMatchObject({ gender: 'en', definite: 'frukosten', plural: 'frukostar', lesson: 'lesson-03' });
    expect(new Set(nouns.map((n) => n.word)).size).toBe(nouns.length);
    const verbs = drillVerbs(notes);
    expect(verbs.find((v) => v.infinitive === 'se')).toMatchObject({ present: 'ser', past: 'såg', supine: 'sett' });
  });
});

describe('journal', () => {
  it('keeps one entry per day and tombstones on delete', async () => {
    await saveJournal('2026-11-17', { text: 'Igår gick jag hem.' });
    await saveJournal('2026-11-17', { feedback: 'bra' });
    await saveJournal('2026-11-16', { text: 'Jag åt lunch.' });
    expect((await listJournal()).map((e) => [e.date, e.text, e.feedback])).toEqual([
      ['2026-11-17', 'Igår gick jag hem.', 'bra'],
      ['2026-11-16', 'Jag åt lunch.', ''],
    ]);
    await deleteJournal('2026-11-16');
    expect(await listJournal()).toHaveLength(1);
    expect(await db.journal.count()).toBe(2);
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it("turns Claude's reply into fix cards and ignores the prose around them", async () => {
    await loadAll();
    const before = (await listNotes()).length;
    const prompt = journalForClaude('2026-11-17', ' Igår jag gick hem. ');
    expect(prompt).toContain('Igår jag gick hem.');
    expect(prompt).toContain('fix | the sentence as I wrote it | the correct sentence');

    const reply = [
      'Corrected version: Igår gick jag hem, och jag åt middag.',
      'Nice work, your verbs are right!',
      '',
      '### Fix the error',
      'fix | Igår jag gick hem. | Igår gick jag hem. | Verb in seat 2 after a time word. | my-mistake, verb-second',
      '- fix | Jag ätade middag. | Jag åt middag. | äta is irregular: åt. | my-mistake, irregular',
      'fix | Vi borde i Denver. | Vi bodde i Denver. | bo takes -dde. | my-mistake, -de',
    ].join('\n');
    const fixes = fixLines(reply);
    expect(fixes.count).toBe(3);
    const r = await applyPlan(await buildPlan(groupLesson(fixes, null, '')), { lessonNumber: null, lessonName: '', extraTags: ['journal'], cardTypes: ['basic', 'reverse'] });
    // The third one is already in My mistakes from Lesson 3: merged, not doubled.
    expect(r).toMatchObject({ added: 2, merged: 1 });
    const notes = await listNotes();
    expect(notes).toHaveLength(before + 2);
    const added = notes.find((n) => n.grammar?.prompt === 'Jag ätade middag.')!;
    expect(added).toMatchObject({ kind: 'fix', tags: ['my-mistake', 'irregular', 'journal'] });
    expect(fixLines('Great job, no mistakes today!').count).toBe(0);
  });
});

describe('my own texts', () => {
  it('are saved, edited and deleted', async () => {
    const t = await saveText({ title: ' Nyheter ', body: 'Det snöar i Sundsvall.' });
    await saveText({ id: t.id, title: 'Nyheter', body: 'Det snöar. Det är kallt.' });
    const [mine] = await listTexts();
    expect(mine).toMatchObject({ id: t.id, title: 'Nyheter' });
    expect(parseText(mine.body, mine.id, false, mine.title).lines).toHaveLength(2);
  });
});

describe('role-play situations', () => {
  it('has a good spread across every category', () => {
    expect(SITUATIONS.length).toBeGreaterThanOrEqual(30);
    for (const c of SITUATION_CATEGORIES) expect(SITUATIONS.filter((t) => t.category === c).length).toBeGreaterThanOrEqual(3);
    expect(new Set(SITUATIONS.map((t) => t.id)).size).toBe(SITUATIONS.length);
  });

  it.each(SITUATIONS.map((t) => [t.id, t] as const))('%s is a complete two-person talk', (_id, t) => {
    expect(SITUATION_CATEGORIES).toContain(t.category);
    expect(t.title).not.toBe('Untitled');
    expect(t.english && t.scene && t.goal).toBeTruthy();
    expect(t.lesson).toBeNull();
    expect(speakersOf(t)).toHaveLength(2);
    expect(speakersOf(t)).toContain('Du');
    expect(t.lines.length).toBeGreaterThanOrEqual(10);
    for (const l of t.lines) expect(l.sv && l.en && l.speaker).toBeTruthy();
    expect(t.lines.filter((l) => l.speaker === 'Du').length).toBeGreaterThanOrEqual(5);
  });
});
