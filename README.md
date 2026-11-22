# Svenska Kort

Flashcards for learning Swedish: vocabulary, grammar and phrases, scheduled with FSRS spaced repetition. It runs in the browser, installs to a phone like an app, and works with no internet.

Live: https://milehighpatriot.github.io/swedish-flashcards/

## Run it

You need Node 20 or newer.

```
npm install
npm run dev        # open the address it prints (usually http://localhost:5173)
```

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Runs the tests (scheduler, lesson parser, importer, answer checking, sync, stats, grammar) |
| `npm run build` | Type-checks and builds the app into `dist/` |
| `npm run preview` | Serves the built app, including offline support |
| `node scripts/make-icons.mjs` | Redraws the app icons |

## Put it on your phone

Open the live address in Chrome on the iPhone, tap Share, then "Add to Home Screen". Open it once while online; after that it works offline. On a Mac, Chrome shows an install icon in the address bar.

## Asking Claude for a lesson

Paste this into your lesson chat, then paste the reply into **Add → Paste** with the lesson number and name filled in.

```
Give me the vocab and grammar for this lesson as a plain text block in exactly
this format, with no extra commentary. One card per line. Leave a field empty
rather than guessing. Keep the ### headings exactly as written, and leave out
any section that has nothing in it.

### Vocab
Swedish | English | forms | Swedish example = English translation | tags

### Phrases
Swedish phrase | English | | Swedish example = English translation | tags

### Grammar rules
rule | question about the rule | answer with an example | short explanation | tags

### Fix the error
fix | sentence with one mistake | corrected sentence | why | tags

### Reorder
reorder | word / word / word (English meaning) | Correct sentence. // Another valid order. | why | tags

### Translate
translate | English sentence | Swedish sentence. // Another valid answer. | why | tags

Rules for the forms field:
- nouns: en hund, hunden, hundar   (article + word, definite, plural)
- verbs: äter, åt, ätit            (present, past, supine)
- adjectives: stor, stort, stora   (en form, ett form, plural)
Tags are lowercase, comma separated, for example: verbs, food, verb-second, -te.
Use my-mistake on fix cards that come from my own writing.
End every reorder prompt with the English meaning in brackets, and only list
Swedish answers that mean exactly that.
```

A finished line looks like this:

```
hund | dog | en hund, hunden, hundar | Hunden springer i parken. = The dog runs in the park. | animals
äta | eat | äter, åt, ätit | Vi äter middag klockan sex. = We eat dinner at six. | verbs, food
fix | I går jag arbetade. | I går arbetade jag. | Verb in seat 2 after a time word. | my-mistake, verb-second
reorder | köpte / jag / en bok / i lördags (Last Saturday I bought a book.) | I lördags köpte jag en bok. // Jag köpte en bok i lördags. | Verb second. | word-order
```

What happens when you save:

- Words go into a deck called "Lesson 07 – Name" (Vocabulary).
- Phrases go into "Phrases – Lesson 07 – Name" (Phrases).
- Rules, reorder and translate cards go into "Grammar – Lesson 07 – Name" (Grammar).
- Fix-the-error cards go into "Grammar – My mistakes", one running deck.
- Every card is tagged `lesson-07` and `week-01` (the week comes from the plan's Week Map). You can change any of this on the preview screen.
- A card that already exists is flagged, and you choose to merge it, skip it or add it anyway.

The parser also copes with tabs, dashes, commas, bullets, numbering and markdown tables. Lines it cannot read are listed with their line number and left out.

Grammar cards link to a notes page through their tags: `-ade`, `-te`, `-de`, `verb-second`, `word-order`, `questions`, `irregular`, `modals`, `connectors`, `negation`, `hem-hemma`, `spelling`, `watch-spelling`, `pronunciation`.

## Importing a lesson

Add → Paste takes text three ways: pasted, uploaded as a `.txt` or `.md` file, or typed. Nothing is saved until you have seen the preview and pressed Save. The text is read in this order:

1. **The flashcard block first.** If the text has `###` sections, it is read as cards in the format above. *This is assumed until the first real Lesson 6 block arrives:* no B2-plan block exists yet, so the format is taken from my Lesson 5 file. The reader is tolerant:
   - code fences (three backticks, with or without a language) around the block are ignored;
   - headings may use any number of `#`, any case and a trailing colon, and these variants work: `Vocabulary`, `Grammar` or `Rules`, `Fix`, `Fix-the-error`, `Fix the errors`, `Reorder the words`, `Translation`;
   - the tags column may be missing, and blank lines are fine;
   - chat text pasted along with the block (before the first heading, after the closing fence, or a line with no pipes) is listed as *skipped*, not as an error;
   - the lesson number is read from a `Lesson N` line; if there is none, the preview asks for it.
2. **A fix-only block.** When the only section is `### Fix the error` (a marked worksheet coming back), the cards go into “Grammar – My mistakes” as before, and each line is also added to **My mistakes** as “Fix this sentence: …” with what I wrote, the correct sentence and the reason.
3. **The lesson printable, as a fallback.** With no `###` sections, the text of the lesson PDF is read by rules. For the best result on a Mac, make the text with poppler (`brew install poppler`):

   ```
   pdftotext -layout lesson6.pdf lesson6.txt
   ```

   What each part becomes:

   | In the lesson | In the app |
   |---|---|
   | Word tables (with en/ett, verb forms, examples) | Vocabulary cards |
   | My own lines in a dialogue (speaker `Du`) | Phrase cards |
   | The story, the dialogue and the reading | Texts for the Reader, Story mode and Dialogue role-play |
   | “Answer in Swedish” and reading questions | Question lines on that text, with the answer left for me to fill in |
   | “Check yourself” items with `(answer: …)` | Rule cards |
   | Fix and translate items with an answer key | Fix and translate cards |
   | Fix and translate items without one | Listed as “needs an answer”; saved only if I type it |
   | Checklist, speaking prompt, conversation questions | The lesson’s row (used by the journal and the checkpoints) |
   | The weak-spot report | A Grammar notes page, “Lesson NN report” |

   Lines the reader could not place are listed with their line number; none is dropped silently. Text copied out of Preview loses its column spacing, so tables come through less well than with `pdftotext -layout`.

Every imported card is tagged `lesson-NN` and `week-NN`, where the week comes from the plan’s Week Map. Importing the same lesson twice flags the duplicates (merge, skip or add) and updates the lesson’s row, texts and report in place.

## Finding your way around

Five tabs:

- **Today:** one button, "Start today's session", a status line from the plan's Weekly Schedule ("Lesson 6, day 1", "Review of Lesson 6", "Checkpoint test"), and a short checklist for the day. Cards and Mistakes tick themselves off; so do Write (a journal entry today) and a checkpoint taken. Speak, Read, the lesson and marked work are plain reminders. If your newest lesson is behind the Week Map, a small note says by how much.
- **Study:** Cards (what to study, cram), My mistakes, and Decks (searchable, grouped by plan week and lesson, current lesson on top, with a + to add).
- **Practice:** the tools under Speaking, Listening, Reading, Writing and Grammar, with a pick for today on top.
- **Learn:** Grammar notes (and weak spots), Browse, and Verbs (the verb table with the drill on the same page).
- **More:** Add, Progress (Checkpoints, Hours and Stats on one screen), Decks and Settings.

Old addresses still work: `/stats`, `/hours` and `/checkpoints` open Progress; the Grammar verb and mistake sub-tabs and `/practice/verbs` open Verbs and My mistakes.

## What is in it

- **Card types:** Swedish → English, English → Swedish, fill in the blank, type the Swedish, listening, grammar rule, fix the error, reorder the words, translate.
- **Study:** everything, one section, one deck or one tag. Daily limits for new cards and reviews. Cram mode ignores the schedule. Undo, edit and suspend without leaving the session. Every scheduled session opens with up to 10 of **My mistakes**. English → Swedish cards are answered by typing (Settings → Scheduling turns that off; verbs and anything on your mistakes list stay typed).
- **Why it was wrong:** under the diff of a wrong typed answer the app names the mistake when it is one of yours: -ade on an -er verb, -te/-de, a regular ending on an irregular verb, the third form as the past, modal + infinitive, måste inte / får inte, verb second, verb-first questions, var / vart, en / ett, object pronouns, possessives, where inte goes, ingen / inget / inga, and a missing chunk such as *lyssna på*. The sentences are fixed templates filled with forms from your own cards. When the difference is not clear-cut it shows the diff alone.
- **Time words:** *igår* and *i går* (and *idag*, *imorgon*, *ikväll*) are the same answer everywhere. The app writes the two-word form.
- **Keys:** Space flips (then rates Good), 1–4 rate, Z undoes, E edits. On a phone, swipe left for Again and right for Good.
- **Swedish:** text-to-speech with a slow button and optional auto-play, å ä ö buttons wherever you type, answers that forgive a missing å/ä/ö with a warning, and en/ett colour labels.
- **Grammar notes (Learn):** editable notes pages, weak-spots study and "Export for Claude".
- **Verbs (Learn):** The **verb table** lists every verb on your cards (infinitive, present, past, third form, English), grouped as -ar (-ade), -er (-te), -er (-de), short (-dde), irregular or modal, with filters by group and lesson. A form your lessons have not given shows as "not in your lessons yet". "Drill these" drills the filtered verbs, mostly the past, and brings up -er verbs, irregular verbs and the ones you have been getting wrong more often.
- **Practice tab:** dictation (hear a sentence from your cards, type it), dialogue role-play (the app speaks the other person's lines and waits for yours), a daily journal, record and compare (your voice next to the Swedish voice), a reader where every word can be tapped and added as a card, a verb drill for present, past and third form, an en/ett drill, and:
  - **Sentence builder:** an English sentence, you type the Swedish, with a word-by-word diff and the reason. Sentences come only from your translate cards, reorder cards, example pairs and text lines. A session of 10 (settable) takes 70% from your current plan week and 30% from older lessons, due sentences first. Each sentence is scheduled like a card; one that was not a translate card becomes one in the "Sentence builder" deck the first time you answer it.
  - **Story mode:** read a text with tap-to-translate, listen to all of it or one line at normal or slow speed, then answer up to 5 questions by typing Swedish. An answer the checker rejects can be counted as right; only answers left wrong go on My mistakes.
  - **Journal:** "Today's question" is picked by the date from your current lesson's questions, skipping any used in the last 7 days. Answer by typing, recording, or both. "Copy for my tutor" copies the date, lesson, question and your answer. The Claude correction flow (corrections come back as fix cards) is unchanged.
- **Stats (in Progress):** review heatmap, retention, cards by maturity, a 14-day forecast, and a streak that forgives a missed day with a freeze.
- **Data:** stored on the device, one-click full backup, CSV import and export.

## The B2 plan

The app follows the Swedish B2 Plan: 58 weeks from Monday 2026-11-23 to 2028-01-01, Lessons 6 to 160. The plan's Week Map and Checkpoints tab are embedded as data in `src/data/plan.ts`; the Google Sheet stays the source of truth, and the app never writes to it.

- **Current week by lesson.** Your current lesson is the highest lesson number among your unlocked decks (Settings → B2 plan can override it). The current week is that lesson's week in the Week Map. Lessons 1 to 5 came from the old plan and count as week 0. Today's status line comes from the calendar date and this lesson.
- **Plan week by date.** The calendar week is the Week Map row whose Monday is on or before today. When your newest lesson is short of what the Week Map expects for today, Today says so ("You're one lesson behind the plan").
- **This week's lesson** (a link on Today; "Start today's session" is the same session) runs your mistakes first, then the due and new cards tagged with any lesson of the current week, within the usual daily limits. After a checkpoint that came out "Close", the following week also includes that checkpoint's review set.
- **My mistakes** (Study → My mistakes). Every wrong typed answer, anywhere in the app, becomes one item: what was asked, what you wrote, the correct form and the reason. An item is fixed after right answers on 3 different study days with no wrong answer in between; a wrong answer sends it back to 0, and a wrong answer on a fixed item brings it back. The list starts with 20 real mistakes from the Lesson 2 to 5 worksheets (`seed/my-mistakes.txt`). The older mistake log on the Grammar tab still records every miss as an event.
- **Checkpoints** (More → Progress). The 14 Sunday checkpoints and the Final follow the plan's dates. One shows on Today from the Monday of its week, is due on its date, and stays "not taken" until you take it or dismiss it. Any checkpoint can be opened as a practice run at any time; that is saved but never counts. Each is 75 minutes in four timed parts with a pause button:
  - Recall, 15 min: the block's words and verb forms from English cues, plus up to 3 open mistakes. Auto-graded.
  - Production, 20 min: English to Swedish sentences and fill-in-the-blanks from the block. Checked when the part ends; a close answer counts and is listed as "watch".
  - Writing, 20 min: the writing task of the newest imported lesson in the block, or "Write 8 to 10 sentences about your week". Self-scored, with "Copy for my tutor".
  - Speaking, 20 min: 4 to 5 questions from the block. Record answers and/or type notes, then answer "Did you carry it without switching to English?". No automatic speaking score.

  **Scoring:** Pass = production 80% or more and speaking "yes". Production 70% to 80%, or 80%+ with speaking "no", is "Close: rebuild next week": the misses are tagged `review-cpN`, added to My mistakes and fed into next week's session. Under 70% is "Repeat this block". Two real checkpoints in a row over 90% on production shows "Ready for harder lessons: tell Claude". "Copy for my sheet" copies Recall, Production, Writing, Speaking and Result as one tab-separated line. A paper checkpoint can be entered by hand. The three old-plan worksheet scores (71%, 70%, 79%) sit in the history and take no part in any result.
- **Hours** (More → Progress). The Hours Log by calendar week, in its five categories: Lessons and review, Speaking, Reading and writing, Flashcards, Own listening. Target 11 hours a week, 9 in weeks 5 and 57, 634 in all. It shows the week against its target, the plan so far, and the whole plan.
  - *Flashcards* is worked out from your reviews: the time on each card, capped at 60 seconds, summed per day. Nothing is stored, so two devices never double-count.
  - *Practice tools and checkpoints* log the time you are active in them (screen visible, touched in the last 60 seconds), as one row per day, category and device, labelled "auto". Story mode and the journal count as Reading and writing; Dialogue, Free conversation, Record and compare and checkpoint speaking as Speaking; the rest as Lessons and review. Auto time can be left out of the totals with one tick.
  - *Everything else* (lessons with Claude, speaking with Claude, paper reading and writing, your own listening) you add by hand, and can edit or delete.
  - "Copy for my sheet" copies the week's five numbers, rounded to a quarter of an hour, as one tab-separated line.

Today shows one measure: today's flashcard minutes against the plan's 15-minute minimum day. The daily goal and the streak are in Progress.

## Built-in content

The starter content lives in `seed/` and loads itself the first time the app opens: your Lesson 1 and 2 grammar file, plus extras taken from the two printables.

From Lesson 3 on, each lesson is its own file in `seed/`, named `lesson-03-irregular-verbs.txt`, with the title on the first line (`# Lesson 03 – Irregular verbs`) and the same `###` sections as a pasted lesson. Every device loads a new file once, the next time the app opens. Words that were waiting in the locked "Coming soon" deck move into the lesson, and a grammar card with the same prompt as an older one is updated instead of doubled. The tags help read the forms: `verbs` or `modals` makes a row a verb, and `pronouns` keeps the forms as a note.

Editing a seed file does not change a device that already loaded it. To reach those devices, raise `BUILT_IN_REVISION` in `src/db/seed.ts` (and `STARTER_REVISION` for the two starter files): on the next start, every built-in card you have never edited is updated in place, keeping its id, its cards and its review history. A built-in card is only ever removed by listing its id in `REMOVED_SEED_IDS`. Built-in ids were first made when the files wrote *igår* as one word; `src/data/seedIdAliases.ts` keeps those ids now that the files write *i går*.

Dialogues and reading texts live in `seed/texts/`, one file each. The first line is the title (`# Lesson 03 – Hur var din dag?`), then one line per sentence: `Speaker | Swedish | English` for a dialogue, `Swedish | English` for a story. A Story mode question is a line `? question | answer // other answer | line number`; it is never shown as part of the text. A new file shows up in the Reader, in Story mode if it has questions, and in Dialogue role-play if it has two speakers. You can also paste your own texts in the Reader.

Role-play situations that are not tied to a lesson (café, doctor, in-laws and so on) live in `seed/situations/`, one file each, in the same line format with four extra header lines: `# Category:` (Everyday, Social, Family, Practical, Travel, Work and home), `# English:`, `# Scene:` and `# Goal:`. Your own lines use the speaker name `Du`. The scene and goal are also what a live chat partner would be given as its brief.

Recordings in Record and compare and in Dialogue role-play are never saved. Recordings you make as a journal answer or in a checkpoint’s speaking part are saved on that device only: they are not synced, and they are included in a backup file. The journal and your own texts are stored like cards: on the device, in backups, and in sync.

## Sync between devices (optional)

Without sync the app works on one device and you move data with a backup file. With sync, signing in with the same account on each device keeps cards, reviews, settings and the streak the same on all of them.

Sync uses a free Supabase project:

1. In the Supabase dashboard, open (or create) a project, go to **SQL Editor**, paste the contents of `supabase/sync.sql` and run it. Everything it creates is named `svenska_*`, so it can share a project with another app.
2. From **Project Settings → API**, copy the project URL and the publishable (anon) key.
3. For the live site, save them as GitHub repository variables named `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then re-run the Pages workflow. For local development, put them in `.env.local` (see `.env.example`).
4. In the app, open **Settings → Sync between devices** and create an account, then sign in with it on each device.

The key is public by design: row-level security means each account can only read and write its own rows. Recordings attached to cards are not synced; other devices read those cards with the Swedish voice instead.

## Natural voice (optional)

By default the app reads Swedish with the device's own voice. For a natural-sounding one (Sofie, a native Swedish voice from Azure Speech):

1. Create an Azure Speech resource on the Free (F0) tier, which includes 0.5 million characters a month.
2. In the app, open Settings → Swedish audio → Natural voice, paste the resource's key and region, and press Turn on.
3. Do the same once on each device. The key stays on the device: it is not built into the app, synced, or written to backup files.

The app fetches each word and sentence once, saves the clip on the device, and plays it from there, so audio works offline. New lessons get their clips the same way, about 12 a minute while the app is open. Slow playback slows the saved clip and keeps its pitch. A card whose clip is not saved yet uses the device voice.

## How it is built

- TypeScript, React and Vite. Installable PWA through `vite-plugin-pwa`.
- Storage is IndexedDB through Dexie. `src/db/repo.ts` is the only module that writes to it. Every row has a UUID, an `updatedAt` time and a soft-delete marker, which is what makes sync a matter of "send rows changed since X, keep the newer copy".
- Scheduling is `ts-fsrs`, wrapped in `src/lib/scheduler.ts`. Target retention is a setting (default 90%).
- `src/lib/` holds the logic that has tests: `parser`, `importer`, `check` (answer checking), `queue` (what to study next), `stats`, `weakspots`, `verbdrill`, `backup`.
- `src/sync/engine.ts` knows nothing about Supabase; it talks to a small `Remote` interface, so another backend could be swapped in.

## Not built yet

- Card generation with the Claude API
- Importing Anki `.apkg` decks
- Image attachments on cards
- Syncing attached recordings
