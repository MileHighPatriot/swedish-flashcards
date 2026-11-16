// The starting text of the grammar notes library, written from the rule cards
// and the Lesson 1 and 2 printables. Each page is plain markdown and can be
// edited in the app; "Reset to original" brings this text back.

export interface DefaultPage {
  slug: string;
  title: string;
  markdown: string;
}

export const DEFAULT_PAGES: DefaultPage[] = [
  {
    slug: 'past-ade',
    title: 'Past tense: -ade',
    markdown: `# Past tense: -ade

If the present tense ends in **-ar**, the past tense ends in **-ade**. Drop the final -a of the infinitive and add -ade. Think of -ade as the Swedish "-ed".

One form for everyone: jag arbetade, du arbetade, hon arbetade, vi arbetade, de arbetade. Unlike English, there are no extra endings for the person.

| Infinitive | Present (now) | Past (then) |
|---|---|---|
| arbeta | arbetar | arbetade |
| laga | lagar | lagade |
| städa | städar | städade |

## Examples
- Jag arbetade igår. *(I worked yesterday.)*
- Hon lagade middag. *(She cooked dinner.)*
- Vi lyssnade på musik. *(We listened to music.)*
- Jag frågade och han svarade. *(I asked and he answered.)*
- Förra veckan spelade de fotboll. *(Last week they played football.)*

## Watch out
- Not the infinitive: ~~Vi städa igår.~~ → Vi städade igår.
- Not the present for yesterday: ~~Hon lagar mat igår.~~ → Hon lagade mat igår. *Igår arbetar jag* means "yesterday I work".
- Never change the verb for the person: vi arbetade and hon arbetade use the same word.

## Not this pattern
köpa (köpte) is on the -te / -de page. gå (gick) is irregular and comes in Lesson 3.
`,
  },
  {
    slug: 'past-te-de',
    title: 'Past tense: -te / -de',
    markdown: `# Past tense: -te / -de

Verbs whose present tense ends in **-er** (or just -r) take **-te** or **-de** instead of -ade. Same good news as before: one past form for every person. Jag köpte, du köpte, hon köpte, vi köpte, de köpte.

## How to choose, every time
1. Drop the final -a of the infinitive. What is left is the stem: köpa → köp, ringa → ring.
2. Look at the last sound of the stem.

| Stem ends in | Ending | Example |
|---|---|---|
| k | -te | åk → åkte, tänk → tänkte |
| ck (counts as k) | -te | tyck → tyckte |
| p | -te | köp → köpte |
| s | -te | läs → läste, res → reste |
| t, x | -te | same rule |
| g | -de | ring → ringde, bygg → byggde |
| r | -de | hör → hörde, hyr → hyrde |
| v | -de | lev → levde |
| a vowel | -dde | bo → bodde, tro → trodde |
| nn | -de | känn → kände (loses one n) |

**Why it works:** k, p, t, s and x are hard sounds made without your voice, so a hard t follows them (köp-te). After a voiced sound like g, n, r or v, the d flows (ring-de).

## Examples
- Jag köpte en bok. *(I bought a book.)*
- Hon läste tidningen. *(She read the newspaper.)*
- Jag ringde min mamma. *(I called my mom.)*
- Vi bodde i Denver. *(We lived in Denver.)*
- Förra veckan reste de till Sverige. *(Last week they traveled to Sweden.)*

## Watch out
- -ade on everything: ~~köpade~~ → köpte. Köpa is a -te verb.
- -de when you need -te: ~~läsde~~ → läste. The stem läs ends in s.
- -te when you need -de: ~~ringte~~ → ringde. The stem ring ends in g.
- Forgetting bo and tro: ~~boade~~ → bodde.
`,
  },
  {
    slug: 'verb-second',
    title: 'Verb second',
    markdown: `# Verb second

In a normal Swedish sentence the verb always sits in **seat 2**. Whatever goes first, the verb takes seat 2. When a time word starts the sentence, it takes seat 1, so the subject moves to seat 3.

| Seat 1 | Seat 2 (verb) | Seat 3 | Rest |
|---|---|---|---|
| Jag | arbetade | | igår. |
| Igår | arbetade | jag | i butiken. |
| I förrgår | lagade | vi | middag. |
| Förra veckan | städade | hon | hela huset. |
| I lördags | köpte | jag | en bok. |

So it is *Igår arbetade jag*, word for word "Yesterday worked I". It sounds odd in English and is exactly right in Swedish.

## Examples
- Igår arbetade jag i butiken. *(Yesterday I worked at the store.)*
- I morse duschade jag. *(This morning I showered.)*
- Förra året reste vi till Sverige. *(Last year we traveled to Sweden.)*
- Sedan handlade jag mat och lagade middag. *(Then I shopped for food and cooked dinner.)*

## Watch out
- ~~Igår jag arbetade.~~ → Igår arbetade jag.
- ~~I lördags jag åkte hem.~~ → I lördags åkte jag hem.
- Starting with the subject is fine too: Jag arbetade i butiken igår. The verb is still in seat 2.
`,
  },
  {
    slug: 'questions',
    title: 'Questions',
    markdown: `# Questions

## Yes/no questions: verb first
English adds "did". Swedish just puts the verb first.

| Statement | Question |
|---|---|
| Du köpte boken. | Köpte du boken? |
| Hon ringde igår. | Ringde hon igår? |
| Ni åkte till bergen. | Åkte ni till bergen? |

## Question words: verb in seat 2
After vad, var, när or hur, the verb stays in seat 2. It is the same verb-second rule.

| Seat 1 | Seat 2 (verb) | Seat 3 |
|---|---|---|
| Vad | köpte | du? |
| Var | bodde | du? |
| Vad | läste | du? |

## Examples
- Läste du boken? *(Did you read the book?)*
- Hörde du mig? *(Did you hear me?)*
- Vad lagade du? *(What did you cook?)*
- Var bodde du? *(Where did you live?)*

## Ready-made
**Vad gjorde du igår?** *(What did you do yesterday?)* Learn it whole. Gjorde is irregular and comes in Lesson 3.
`,
  },
  {
    slug: 'modals',
    title: 'Modals + infinitive',
    markdown: `# Modals + infinitive

After **kan, vill, ska, måste, får** the next verb is the **infinitive**. Never add -r after a modal.

| Infinitive | Present | Past | Meaning |
|---|---|---|---|
| kunna | kan | kunde | can, be able to |
| vilja | vill | ville | want |
| skola | ska | skulle | shall, will |
| måste | måste | var tvungen | must |

## Examples
- Jag kan prata svenska. *(I can speak Swedish.)*
- Jag lär mig svenska så att jag kan prata med min svärmor. *(I am learning Swedish so that I can talk with my mother-in-law.)*
- Jag vill prata svenska. *(I want to speak Swedish.)*
- Vi ska laga middag. *(We are going to cook dinner.)*
- Jag måste arbeta. *(I have to work.)*

## Watch out
- ~~Jag kan pratar svenska.~~ → Jag kan prata svenska.
`,
  },
  {
    slug: 'connectors',
    title: 'så att / som',
    markdown: `# så att / som

## så att = so that
**så att** gives a purpose. Do not drop "att".

- Jag lär mig svenska så att jag kan prata med min svärmor. *(I am learning Swedish so that I can talk with my mother-in-law.)*
- ~~Jag lär mig svenska så jag kan prata.~~ → Jag lär mig svenska så att jag kan prata.

## som = who, that
**som** replaces the subject of the second part. Do not add han or hon after it.

- Jag har en vän som bor i Sverige. *(I have a friend who lives in Sweden.)*
- ~~Jag har en vän som han bor i Sverige.~~ → Jag har en vän som bor i Sverige.

| Word | Job | Example |
|---|---|---|
| så att | purpose, "so that" | … så att jag kan prata. |
| som | replaces the subject | en vän som bor i Sverige |
`,
  },
  {
    slug: 'inte',
    title: 'Where inte goes',
    markdown: `# Where inte goes

| Kind of clause | inte goes | Example |
|---|---|---|
| Main clause | after the verb | Han kommer inte. |
| Subordinate clause (after att, som, om) | before the verb | Jag vet att han inte kommer. |

## Examples
- Han kommer inte. *(He is not coming.)*
- Jag vet att han inte kommer. *(I know that he is not coming.)*

## Watch out
- ~~Jag vet att han kommer inte.~~ → Jag vet att han inte kommer.

Quick check: is there an att, som or om just before? Then inte jumps in front of the verb.
`,
  },
  {
    slug: 'hem-hemma',
    title: 'hem / hemma',
    markdown: `# hem / hemma

Movement versus place.

| Word | Means | Example |
|---|---|---|
| hem | direction: going home | Jag går hem. |
| hemma | location: at home | Jag är hemma. |

## Examples
- Jag går hem. *(I am going home.)*
- Jag är hemma. *(I am at home.)*
- I lördags åkte jag hem. *(Last Saturday I went home.)*
- Igår städade vi hemma. *(Yesterday we cleaned at home.)*

## Watch out
- ~~Jag är hem.~~ → Jag är hemma.
- ~~Jag går hemma.~~ → Jag går hem.
`,
  },
  {
    slug: 'spelling',
    title: 'Capitalization & spelling',
    markdown: `# Capitalization & spelling

## Capital letters
Only the first word of a sentence and names get a capital. Days, months and languages are lowercase: lördag, november, svenska.

- ~~Jag Lagade middag och Vi åt.~~ → Jag lagade middag och vi åt.

## Always type å, ä, ö
They are separate letters, not decoration.

- ~~Jag alskar min svarmor.~~ → Jag älskar min svärmor.

## My watch-list
| Write | Not | Why |
|---|---|---|
| lyssnade | lysnade | lyssna has a double s |
| musik | music | the Swedish spelling |
| middag | | double d |
| fotboll | | double l |
| ledig | off | ledig = off, free from work |
| var | vart | var = was, vart = where to |
| igår kväll | ikväll | ikväll = tonight, igår kväll = last night |
| mina barn | min barnet | plural possessive is mina, and barn does not change |

Also worth writing out a few times: affären, svarade, duschade, förra veckan, och.
`,
  },
  {
    slug: 'pronunciation',
    title: 'Pronunciation',
    markdown: `# Pronunciation

- Stress the **first syllable**.
- Say the final -e like the e in "bed".
- **k** before ö, ä, e, i, y is a soft "sh"-like sound.
- **ö** is like the "er" in "her" without the r.

| Word | Sounds like |
|---|---|
| arbetade | AR-beh-tah-deh |
| lagade | LAH-gah-deh |
| städade | STEH-dah-deh |
| tittade | TIT-tah-deh |
| köpte | SHERP-teh |
| läste | LEHS-teh |
| reste | RESS-teh |
| ringde | RING-deh |
| hörde | HER-deh |
| bodde | BOD-deh |

These are approximations. Use the play button on a card, or search the word on forvo.com, to hear it.
`,
  },
];
