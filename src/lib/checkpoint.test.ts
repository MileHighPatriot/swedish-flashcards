import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKPOINTS } from '../data/plan';
import { db } from '../db/db';
import { SEED_TIME, listCheckpoints, listLessons, listMistakeItems, listNotes, saveCheckpoint } from '../db/repo';
import type { Checkpoint } from '../db/types';
import {
  OLD_PLAN_SCORES,
  SECTION_MINUTES,
  blockLessons,
  checkpointState,
  clock,
  gradeItem,
  openCheckpoint,
  pause,
  productionItems,
  readyForHarder,
  recallItems,
  resultOf,
  resume,
  reviewTagFor,
  scoreOf,
  sheetLine,
  speakingForTutor,
  speakingQuestions,
  startCountdown,
  tick,
  writingForTutor,
  writingTask,
} from './checkpoint';
import { latestSitting, weekSessionTags } from './plan';
import { BUILT_IN_TEXTS } from './texts';

const cp1 = CHECKPOINTS[0];
const cp2 = CHECKPOINTS[1];
const row = (over: Partial<Checkpoint>): Checkpoint => ({
  id: `r${Math.random()}`,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  cp: 'CP1',
  kind: 'app',
  label: 'Checkpoint 1',
  week: 4,
  date: '2026-12-20',
  at: 1,
  practice: false,
  recall: 0.8,
  production: 0.8,
  writing: 0.7,
  writingSelfScored: true,
  speakingWithoutEnglish: true,
  result: 'pass',
  items: [],
  reviewTag: null,
  ...over,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.resetModules();
});

describe('when a checkpoint shows', () => {
  it('follows the plan table: from the Monday of its week, due on its date, not taken afterwards', () => {
    expect(checkpointState(cp1, '2026-12-13', [])).toBe('upcoming');
    expect(checkpointState(cp1, '2026-12-14', [])).toBe('this-week');
    expect(checkpointState(cp1, '2026-12-19', [])).toBe('this-week');
    expect(checkpointState(cp1, '2026-12-20', [])).toBe('due');
    expect(checkpointState(cp1, '2026-12-21', [])).toBe('not-taken');
    expect(checkpointState(cp1, '2027-03-01', [])).toBe('not-taken');
    expect(checkpointState(cp1, new Date(2026, 11, 20, 23, 30).getTime(), [])).toBe('due');
    // The Final is on a Saturday and shows from the Monday before.
    const final = CHECKPOINTS[14];
    expect(checkpointState(final, '2027-12-26', [])).toBe('upcoming');
    expect(checkpointState(final, '2027-12-27', [])).toBe('this-week');
    expect(checkpointState(final, '2028-01-01', [])).toBe('due');
  });

  it('a real sitting takes it; a practice run does not; a dismissal clears it', () => {
    expect(checkpointState(cp1, '2026-12-22', [row({ practice: true })])).toBe('not-taken');
    expect(checkpointState(cp1, '2026-12-22', [row({})])).toBe('taken');
    expect(checkpointState(cp1, '2026-12-22', [row({ kind: 'paper' })])).toBe('taken');
    expect(checkpointState(cp1, '2026-12-22', [row({ kind: 'dismissed', production: null, result: null })])).toBe('dismissed');
    expect(checkpointState(cp1, '2026-12-22', [row({ deletedAt: 5 })])).toBe('not-taken');
    expect(checkpointState(cp1, '2026-12-22', [row({ cp: '', kind: 'old-plan-paper' })])).toBe('not-taken');
    expect(checkpointState(cp2, '2026-12-22', [row({})])).toBe('upcoming');
  });

  it('Home mentions the earliest open one', () => {
    expect(openCheckpoint('2026-12-01', [])).toBeNull();
    expect(openCheckpoint('2026-12-15', [])).toMatchObject({ cp: { cp: 'CP1' }, state: 'this-week' });
    expect(openCheckpoint('2027-01-12', [])).toMatchObject({ cp: { cp: 'CP1' }, state: 'not-taken' });
    expect(openCheckpoint('2027-01-12', [row({})])).toMatchObject({ cp: { cp: 'CP2' }, state: 'this-week' });
    expect(openCheckpoint('2026-12-28', [row({})])).toBeNull();
  });

  it('knows its block', () => {
    expect(blockLessons('CP1')).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(blockLessons('CP2')).toEqual([17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
    expect(blockLessons('Final').length).toBe(160);
  });
});

describe('the result', () => {
  it('follows the plan: 80% on production and speaking without English to pass', () => {
    expect(resultOf(0.69, true)).toBe('repeat');
    expect(resultOf(0.7, true)).toBe('close');
    expect(resultOf(0.79, true)).toBe('close');
    expect(resultOf(0.8, true)).toBe('pass');
    expect(resultOf(0.8, false)).toBe('close');
    expect(resultOf(1, false)).toBe('close');
    expect(resultOf(0.69, false)).toBe('repeat');
    expect(resultOf(null, true)).toBeNull();
    // Scores are counts: 8 of 10 and 7 of 10 land exactly on the marks.
    expect(resultOf(8 / 10, true)).toBe('pass');
    expect(resultOf(7 / 10, true)).toBe('close');
    expect(resultOf(11 / 14, true)).toBe('close');
  });

  it('counts close answers as right in production only', () => {
    expect(scoreOf(['correct', 'close', 'wrong', 'correct'], true)).toBe(0.75);
    expect(scoreOf(['correct', 'close', 'wrong', 'correct'], false)).toBe(0.5);
    expect(scoreOf([], true)).toBeNull();
  });

  it('"ready for harder lessons": the last two sittings are real and both over 90%', () => {
    const a = row({ cp: 'CP1', at: 10, production: 0.93 });
    const b = row({ cp: 'CP2', at: 20, production: 0.95 });
    expect(readyForHarder([a, b])).toBe(true);
    expect(readyForHarder([b, a])).toBe(true);
    expect(readyForHarder([a])).toBe(false);
    expect(readyForHarder([a, row({ cp: 'CP2', at: 20, production: 0.9 })])).toBe(false);
    // A practice run between them breaks the pair, even a perfect one.
    expect(readyForHarder([a, row({ cp: 'CP2', at: 15, production: 1, practice: true }), b])).toBe(false);
    // Once two more real ones follow, it is true again.
    expect(readyForHarder([a, row({ at: 15, production: 1, practice: true }), b, row({ cp: 'CP3', at: 30, production: 0.91 })])).toBe(true);
    // Old-plan paper scores, dismissals and deleted rows take no part.
    expect(readyForHarder([a, row({ cp: '', kind: 'old-plan-paper', at: 15, production: 0.5 }), row({ kind: 'dismissed', at: 16, production: null }), row({ at: 17, deletedAt: 1, production: 0.1 }), b])).toBe(true);
    expect(readyForHarder([row({ cp: '', kind: 'old-plan-paper', at: 1, production: 0.95 }), row({ cp: '', kind: 'old-plan-paper', at: 2, production: 0.95 })])).toBe(false);
  });

  it('copies one tab-separated line for the sheet: Recall, Production, Writing, Speaking, Result', () => {
    expect(sheetLine(row({ recall: 0.85, production: 0.8, writing: 0.7, speakingWithoutEnglish: true, result: 'pass' }))).toBe('85%\t80%\t70%\tyes\tPass');
    expect(sheetLine(row({ recall: 0.6, production: 0.75, writing: null, speakingWithoutEnglish: false, result: 'close' }))).toBe('60%\t75%\t\tno\tClose: rebuild next week');
    expect(sheetLine(row({ recall: null, production: 0.5, writing: 0.4, speakingWithoutEnglish: null, result: 'repeat' }))).toBe('\t50%\t40%\t\tRepeat this block');
    expect(sheetLine(row({})).split('\t').length).toBe(5);
  });

  it('a Close feeds its review tag into the following week’s session, and only a real one', () => {
    expect(reviewTagFor('CP1')).toBe('review-cp1');
    const close = row({ result: 'close', production: 0.75, reviewTag: reviewTagFor('CP1'), at: 5 });
    expect(weekSessionTags(5, [close])).toEqual(['lesson-17', 'lesson-18', 'review-cp1']);
    expect(weekSessionTags(4, [close])).toEqual(['lesson-15', 'lesson-16']);
    expect(weekSessionTags(5, [{ ...close, practice: true }])).toEqual(['lesson-17', 'lesson-18']);
    expect(latestSitting([close, row({ at: 9 })], 'CP1')!.at).toBe(9);
  });
});

describe('section timers', () => {
  it('are 15, 20, 20 and 20 minutes: 75 in all', () => {
    expect(SECTION_MINUTES).toEqual({ recall: 15, production: 20, writing: 20, speaking: 20 });
    expect(Object.values(SECTION_MINUTES).reduce((a, b) => a + b, 0)).toBe(75);
  });

  it('count down, stop while paused, and end the section at zero', () => {
    let c = startCountdown(15);
    expect(clock(c.remainingMs)).toBe('15:00');
    c = tick(c, 55_000);
    expect(clock(c.remainingMs)).toBe('14:05');
    c = pause(c);
    c = tick(c, 600_000);
    expect(clock(c.remainingMs)).toBe('14:05');
    expect(c.ended).toBe(false);
    c = resume(c);
    c = tick(c, 14 * 60_000);
    expect(c).toMatchObject({ ended: false, running: true });
    expect(clock(c.remainingMs)).toBe('0:05');
    c = tick(c, 5_000);
    expect(c).toEqual({ remainingMs: 0, running: false, ended: true });
    // Nothing brings an ended section back.
    expect(resume(c)).toBe(c);
    expect(tick(c, 1000)).toBe(c);
    expect(tick(startCountdown(20), 99 * 60_000)).toMatchObject({ remainingMs: 0, ended: true });
  });
});

describe('what a checkpoint asks, from my real cards', () => {
  let s = 3;
  const rng = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const load = async () => {
    await (await import('../db/seed')).ensureSeeded();
    return { cp: 'CP1', notes: await listNotes(), texts: BUILT_IN_TEXTS, items: await listMistakeItems(), lessons: await listLessons(), now: Date.now(), dayStartHour: 4, rng };
  };

  it('recall: words and verb forms of the block, then up to 3 open mistakes', async () => {
    const input = await load();
    const items = recallItems(input);
    expect(items.filter((i) => i.label === 'Say it in Swedish').length).toBe(12);
    expect(items.filter((i) => i.label === 'Past tense of').length).toBe(6);
    const mistakes = items.filter((i) => i.mistake);
    expect(mistakes.length).toBe(3);
    expect(items.slice(-3)).toEqual(mistakes);
    expect(mistakes[0].prompt).toBe('We lived in Denver.');
    // Every answer is one of my own forms, and grades as right.
    const forms = new Set(input.notes.flatMap((n) => [n.swedish, n.verb?.past ?? '']));
    for (const i of items.filter((x) => !x.mistake)) {
      expect(forms.has(i.answers[0]), i.answers[0]).toBe(true);
      expect(gradeItem(i, i.answers[0]).verdict).toBe('correct');
    }
    expect(recallItems({ ...input, cp: 'CP2' }).filter((i) => !i.mistake)).toEqual([]);
  });

  it('production: sentences to translate and blanks from example sentences, all from the block', async () => {
    const input = await load();
    const items = productionItems(input);
    expect(items.filter((i) => i.label === 'Say it in Swedish').length).toBe(8);
    expect(items.filter((i) => i.label === 'Fill in the blank').length).toBe(6);
    for (const i of items) {
      expect(i.prompt.length).toBeGreaterThan(3);
      for (const a of i.answers) expect(gradeItem(i, a).verdict, a).toBe('correct');
    }
    const blank = items.find((i) => i.label === 'Fill in the blank')!;
    expect(blank.prompt).toContain('____');
    const note = input.notes.find((n) => n.id === blank.noteId)!;
    expect(note.exampleSv).toContain(blank.answers[0]);
  });

  it('writing: the default task with the block’s grammar until a lesson brings its own', async () => {
    const mine = writingTask('CP1', []);
    expect(mine.lesson).toBeNull();
    expect(mine.task).toContain('Write 8 to 10 sentences about your week.');
    expect(mine.task).toContain('negation: where inte goes');
    expect(mine.selfCheck.some((x) => x.includes('subordinate clauses with att, om, när, för att, eftersom'))).toBe(true);
    const lesson = (number: number, task: string) => ({ number, writingTask: task, deletedAt: null });
    expect(writingTask('CP1', [lesson(6, 'Write five sentences with inte.'), lesson(9, 'Write about your weekend with att and eftersom.'), lesson(20, 'Later block.')])).toMatchObject({
      lesson: 9,
      task: 'Write about your weekend with att and eftersom.',
    });
    expect(writingTask('CP2', []).task).toBe('Write 8 to 10 sentences about your week.');
    expect(writingForTutor({ cp: 'CP1', date: '2026-12-20', task: 'T', text: ' Jag skrev en lista. ' })).toBe('Checkpoint 1, writing, 2026-12-20\nTask: T\n\nMy text:\nJag skrev en lista.');
  });

  it('speaking: up to 5 questions from the block’s lessons, and the hand-off text', () => {
    const qs = speakingQuestions('CP1', [], rng);
    expect(qs.length).toBe(5);
    expect(qs.every((q) => q.lesson != null && q.lesson <= 16 && q.sv.endsWith('?'))).toBe(true);
    // A block with no questions of its own falls back to everything I have.
    expect(speakingQuestions('CP2', [], rng).length).toBe(5);
    const fromLesson = speakingQuestions('CP2', [{ number: 17, questions: [{ sv: 'Var bor du?', en: 'Where do you live?' }], deletedAt: null }], rng);
    expect(fromLesson).toEqual([{ lesson: 17, sv: 'Var bor du?', en: 'Where do you live?' }]);
    expect(speakingForTutor({ cp: 'Final', date: '2028-01-01', questions: ['Hur var din dag?'], notes: '', recordings: 2 })).toBe(
      'Final exam, speaking, 2028-01-01\nQuestions:\n1. Hur var din dag?\n\nMy notes:\n(no notes)\n\n(recordings saved on my phone)',
    );
    expect(speakingForTutor({ cp: 'CP3', date: 'd', questions: [], notes: 'ok', recordings: 0 })).not.toContain('recordings');
  });
});

describe('my old-plan paper scores', () => {
  it('load once with fixed ids and seed stamps, show in the history, and stay out of every result rule', async () => {
    const { ensureSeeded } = await import('../db/seed');
    await ensureSeeded();
    const first = await listCheckpoints();
    expect(first.map((r) => [r.id, r.kind, r.label, r.production])).toEqual([
      ['seed:checkpoint:old-lesson-2', 'old-plan-paper', 'Lesson 2 worksheet', 0.71],
      ['seed:checkpoint:old-lesson-3', 'old-plan-paper', 'Lesson 3 worksheet', 0.7],
      ['seed:checkpoint:old-lesson-4', 'old-plan-paper', 'Lesson 4 worksheet (old Week 1 checkpoint)', 0.79],
    ]);
    expect(OLD_PLAN_SCORES.length).toBe(3);
    expect(first.every((r) => r.updatedAt < SEED_TIME + 1_000_000 && r.result === null && r.cp === '')).toBe(true);
    vi.resetModules();
    await (await import('../db/seed')).ensureSeeded();
    const { seedOldPlanScores } = await import('../db/seed');
    await seedOldPlanScores();
    expect(await listCheckpoints()).toEqual(first);

    expect(readyForHarder(first)).toBe(false);
    expect(openCheckpoint('2026-12-21', first)).toMatchObject({ cp: { cp: 'CP1' }, state: 'not-taken' });
    expect(weekSessionTags(5, first)).toEqual(['lesson-17', 'lesson-18']);
    expect(CHECKPOINTS.every((c) => latestSitting(first, c.cp) === undefined)).toBe(true);
    // A real sitting saved next to them is found as usual.
    const { id: _id, createdAt: _c, updatedAt: _u, deletedAt: _d, ...real } = row({ production: 0.95, at: 50 });
    await saveCheckpoint(real);
    expect(latestSitting(await listCheckpoints(), 'CP1')!.production).toBe(0.95);
  });
});
