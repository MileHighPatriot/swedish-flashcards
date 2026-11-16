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
reorder | word / word / word | Correct sentence. // Another valid order. | why | tags

### Translate
translate | English sentence | Swedish sentence. // Another valid answer. | why | tags

Rules for the forms field:
- nouns: en hund, hunden, hundar   (article + word, definite, plural)
- verbs: äter, åt, ätit            (present, past, supine)
- adjectives: stor, stort, stora   (en form, ett form, plural)
Tags are lowercase, comma separated, for example: verbs, food, verb-second, -te.
Use my-mistake on fix cards that come from my own writing.
```

A finished line looks like this:

```
hund | dog | en hund, hunden, hundar | Hunden springer i parken. = The dog runs in the park. | animals
äta | eat | äter, åt, ätit | Vi äter middag klockan sex. = We eat dinner at six. | verbs, food
fix | Igår jag arbetade. | Igår arbetade jag. | Verb in seat 2 after a time word. | my-mistake, verb-second
reorder | köpte / jag / en bok / i lördags | I lördags köpte jag en bok. // Jag köpte en bok i lördags. | Verb second. | word-order
```

What happens when you save:

- Words go into a deck called "Lesson 07 – Name" (Vocabulary).
- Phrases go into "Phrases – Lesson 07 – Name" (Phrases).
- Rules, reorder and translate cards go into "Grammar – Lesson 07 – Name" (Grammar).
- Fix-the-error cards go into "Grammar – My mistakes", one running deck.
- Every card is tagged `lesson-07`. You can change any of this on the preview screen.
- A card that already exists is flagged, and you choose to merge it, skip it or add it anyway.

The parser also copes with tabs, dashes, commas, bullets, numbering and markdown tables. Lines it cannot read are listed with their line number and left out.

Grammar cards link to a notes page through their tags: `-ade`, `-te`, `-de`, `verb-second`, `word-order`, `questions`, `modals`, `connectors`, `negation`, `hem-hemma`, `spelling`, `watch-spelling`, `pronunciation`.

## What is in it

- **Card types:** Swedish → English, English → Swedish, fill in the blank, type the Swedish, listening, grammar rule, fix the error, reorder the words, translate.
- **Study:** everything, one section, one deck or one tag. Daily limits for new cards and reviews. Cram mode ignores the schedule. Undo, edit and suspend without leaving the session.
- **Keys:** Space flips (then rates Good), 1–4 rate, Z undoes, E edits. On a phone, swipe left for Again and right for Good.
- **Swedish:** text-to-speech with a slow button and optional auto-play, å ä ö buttons wherever you type, answers that forgive a missing å/ä/ö with a warning, and en/ett colour labels.
- **Grammar tab:** editable notes pages, a mistake log, weak-spots study, "Export for Claude", and a past-tense verb drill.
- **Stats:** review heatmap, retention, cards by maturity, a 14-day forecast, and a streak that forgives a missed day with a freeze.
- **Data:** stored on the device, one-click full backup, CSV import and export.

The starter content lives in `seed/` and loads itself the first time the app opens: your Lesson 1 and 2 grammar file, plus extras taken from the two printables.

## Sync between devices (optional)

Without sync the app works on one device and you move data with a backup file. With sync, signing in with the same account on each device keeps cards, reviews, settings and the streak the same on all of them.

Sync uses a free Supabase project:

1. In the Supabase dashboard, open (or create) a project, go to **SQL Editor**, paste the contents of `supabase/sync.sql` and run it. Everything it creates is named `svenska_*`, so it can share a project with another app.
2. From **Project Settings → API**, copy the project URL and the publishable (anon) key.
3. For the live site, save them as GitHub repository variables named `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then re-run the Pages workflow. For local development, put them in `.env.local` (see `.env.example`).
4. In the app, open **Settings → Sync between devices** and create an account, then sign in with it on each device.

The key is public by design: row-level security means each account can only read and write its own rows. Recordings attached to cards are not synced; other devices read those cards with the Swedish voice instead.

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
