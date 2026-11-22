import { db } from './db';
import { SEED_TIME, createDeck, createNotes, emptyNoteInput, ensureGrammarPages, getKV, setKV, type NoteInput } from './repo';
import type { PartOfSpeech } from './types';
import { BUILT_IN_LESSONS, loadBuiltInLesson, loadStarterLessons, refreshBuiltIn, refreshStarterCards } from '../lib/importer';

type Seed = {
  sv: string;
  en: string;
  pos: PartOfSpeech;
  ex: [string, string];
  tags: string[];
  noun?: ['en' | 'ett', string, string];
  verb?: [string, string, string, string];
  adj?: [string, string, string];
};

const WORDS: Seed[] = [
  { sv: 'hej', en: 'hello, hi', pos: 'interjection', ex: ['Hej, hur mår du?', 'Hi, how are you?'], tags: ['greetings'] },
  { sv: 'tack', en: 'thanks, thank you', pos: 'interjection', ex: ['Tack så mycket!', 'Thank you so much!'], tags: ['greetings'] },
  { sv: 'hund', en: 'dog', pos: 'noun', noun: ['en', 'hunden', 'hundar'], ex: ['Hunden springer i parken.', 'The dog runs in the park.'], tags: ['animals'] },
  { sv: 'katt', en: 'cat', pos: 'noun', noun: ['en', 'katten', 'katter'], ex: ['Katten sover på soffan.', 'The cat is sleeping on the sofa.'], tags: ['animals'] },
  { sv: 'hus', en: 'house', pos: 'noun', noun: ['ett', 'huset', 'hus'], ex: ['Vi bor i ett rött hus.', 'We live in a red house.'], tags: ['home'] },
  { sv: 'äpple', en: 'apple', pos: 'noun', noun: ['ett', 'äpplet', 'äpplen'], ex: ['Jag äter ett äpple varje dag.', 'I eat an apple every day.'], tags: ['food'] },
  { sv: 'bok', en: 'book', pos: 'noun', noun: ['en', 'boken', 'böcker'], ex: ['Jag läser en bra bok.', 'I am reading a good book.'], tags: ['home'] },
  { sv: 'barn', en: 'child', pos: 'noun', noun: ['ett', 'barnet', 'barn'], ex: ['Barnet leker i trädgården.', 'The child is playing in the garden.'], tags: ['family'] },
  { sv: 'familj', en: 'family', pos: 'noun', noun: ['en', 'familjen', 'familjer'], ex: ['Min familj bor i Sundsvall.', 'My family lives in Sundsvall.'], tags: ['family', 'Sundsvall'] },
  { sv: 'vän', en: 'friend', pos: 'noun', noun: ['en', 'vännen', 'vänner'], ex: ['Hon är min bästa vän.', 'She is my best friend.'], tags: ['family'] },
  { sv: 'vatten', en: 'water', pos: 'noun', noun: ['ett', 'vattnet', 'vatten'], ex: ['Kan jag få ett glas vatten?', 'Can I have a glass of water?'], tags: ['food'] },
  { sv: 'kaffe', en: 'coffee', pos: 'noun', noun: ['ett', 'kaffet', ''], ex: ['Vill du ha kaffe?', 'Do you want coffee?'], tags: ['food'] },
  { sv: 'vara', en: 'to be', pos: 'verb', verb: ['vara', 'är', 'var', 'varit'], ex: ['Jag är trött i dag.', 'I am tired today.'], tags: ['verbs'] },
  { sv: 'ha', en: 'to have', pos: 'verb', verb: ['ha', 'har', 'hade', 'haft'], ex: ['Jag har två bröder.', 'I have two brothers.'], tags: ['verbs', 'family'] },
  { sv: 'heta', en: 'to be called', pos: 'verb', verb: ['heta', 'heter', 'hette', 'hetat'], ex: ['Vad heter du?', 'What is your name?'], tags: ['verbs', 'greetings'] },
  { sv: 'bo', en: 'to live (reside)', pos: 'verb', verb: ['bo', 'bor', 'bodde', 'bott'], ex: ['Var bor du?', 'Where do you live?'], tags: ['verbs', 'home'] },
  { sv: 'äta', en: 'to eat', pos: 'verb', verb: ['äta', 'äter', 'åt', 'ätit'], ex: ['Vi äter middag klockan sex.', 'We eat dinner at six o’clock.'], tags: ['verbs', 'food'] },
  { sv: 'stor', en: 'big, large', pos: 'adjective', adj: ['stor', 'stort', 'stora'], ex: ['Stockholm är en stor stad.', 'Stockholm is a big city.'], tags: ['adjectives'] },
  { sv: 'liten', en: 'small, little', pos: 'adjective', adj: ['liten', 'litet', 'små'], ex: ['Jag har en liten lägenhet.', 'I have a small apartment.'], tags: ['adjectives', 'home'] },
  { sv: 'god', en: 'good, tasty', pos: 'adjective', adj: ['god', 'gott', 'goda'], ex: ['Maten är mycket god.', 'The food is very tasty.'], tags: ['adjectives', 'food'] },
];

export const SEED_DECK_NAME = 'Lesson 00 – Starter words';

/** Raise this number whenever the starter files in seed/ change (grammar cards refresh in place). */
export const STARTER_REVISION = 3;
/**
 * Raise this number whenever any built-in card changes: a seed file edit, or an
 * id added to REMOVED_SEED_IDS. Editing a seed file alone does not reach a
 * device that already loaded it; this does.
 */
export const BUILT_IN_REVISION = 1;

let seeding: Promise<void> | null = null;

/** Adds the sample deck the first time the app runs. Safe to call repeatedly. */
export function ensureSeeded(): Promise<void> {
  seeding ??= (async () => {
    // Don't re-seed over real data (e.g. after a restore that lacked the flag).
    if (!(await getKV<boolean>('seeded')) && (await db.notes.count()) === 0) {
      const deck = await createDeck({
        name: SEED_DECK_NAME,
        category: 'vocab',
        lessonNumber: 0,
        lessonName: 'Starter words',
        description: 'A sample deck of beginner words. Delete it whenever you like.',
      }, { id: 'seed:deck:lesson-00', at: SEED_TIME });
      const inputs: NoteInput[] = WORDS.map((w) => ({
        ...emptyNoteInput(deck.id),
        swedish: w.sv,
        english: w.en,
        pos: w.pos,
        exampleSv: w.ex[0],
        exampleEn: w.ex[1],
        tags: w.tags,
        lessonNumber: 0,
        lessonName: 'Starter words',
        noun: w.noun ? { gender: w.noun[0], definite: w.noun[1], plural: w.noun[2] } : null,
        verb: w.verb ? { infinitive: w.verb[0], present: w.verb[1], past: w.verb[2], supine: w.verb[3] } : null,
        adjective: w.adj ? { common: w.adj[0], neuter: w.adj[1], plural: w.adj[2] } : null,
      }));
      await createNotes(inputs, { idFor: (n) => `seed:lesson-00:${n.swedish}`, at: SEED_TIME });
    }
    await setKV('seeded', true);
    await ensureGrammarPages();
    // Lessons 1 and 2 (grammar, phrases, verb lists). Loaded once; the button on
    // the Add screen can load them again.
    if (!(await getKV<boolean>('starterLoaded'))) {
      await loadStarterLessons();
      await setKV('starterLoaded', true);
    }
    if (((await getKV<number>('starterRevision')) ?? 1) < STARTER_REVISION) {
      await refreshStarterCards();
      await setKV('starterRevision', STARTER_REVISION);
    }
    // The same for every built-in card, words included (see refreshBuiltIn).
    if (((await getKV<number>('builtInRevision')) ?? 0) < BUILT_IN_REVISION) {
      await refreshBuiltIn();
      await setKV('builtInRevision', BUILT_IN_REVISION);
    }
    // Lesson 3 onwards: each seed/lesson-NN-*.txt file is loaded once per device.
    const loaded = (await getKV<string[]>('builtInLessons')) ?? [];
    for (const lesson of BUILT_IN_LESSONS) {
      if (loaded.includes(lesson.key)) continue;
      await loadBuiltInLesson(lesson);
      loaded.push(lesson.key);
      await setKV('builtInLessons', [...loaded]);
    }
  })();
  return seeding;
}
