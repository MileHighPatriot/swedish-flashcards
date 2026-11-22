// The starting text of the grammar notes library, written from the rule cards
// and the Lesson 1 and 2 printables. Each page is plain markdown and can be
// edited in the app; "Reset to original" brings this text back.

export interface DefaultPage {
  slug: string;
  title: string;
  markdown: string;
  /** Where the page sits in the list. Defaults to its place in this file. */
  order?: number;
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
    slug: 'irregular',
    title: 'Irregular verbs',
    // Added with Lesson 3. Sits after the two regular past-tense pages on every device.
    order: 2.5,
    markdown: `# Irregular verbs

The ten most common verbs break the -ade, -te and -de patterns, just like English go / went, eat / ate, see / saw. You cannot work them out, so you learn each past form once.

Still one form for every person: jag gick, du gick, hon gick, vi gick.

| Infinitive | Present | Past | English | Third form |
|---|---|---|---|---|
| gå | går | **gick** | go, walk | gått |
| äta | äter | **åt** | eat | ätit |
| se | ser | **såg** | see | sett |
| vara | är | **var** | be | varit |
| ha | har | **hade** | have | haft |
| göra | gör | **gjorde** | do, make | gjort |
| komma | kommer | **kom** | come | kommit |
| få | får | **fick** | get, receive | fått |
| ta | tar | **tog** | take | tagit |
| ge | ger | **gav** | give | gett |

The third form is for later. You only need it after har: Jag har sett filmen.

## Memory hooks
| Pattern | Verbs |
|---|---|
| Sounds like the English past | åt = ate, såg = saw, tog = took, gav = gave, kom = came |
| A rhyming pair | gå → gick and få → fick (both end in -ick) |
| Almost regular | hade (ha + de) and gjorde (göra + de, with gj). Both end in -de. |
| The odd one | var means was for every person: jag var, du var, vi var. Var also means where: Var var du? *(Where were you?)* |

## How to say it
The letter g before i, e, ä, ö, y sounds like English y. The letters gj also sound like y.

| Word | Sounds like |
|---|---|
| gick | YICK |
| gjorde | YOOR-deh |
| såg | SOHG (like "saw" with a g) |
| tog | TOOG |
| gav | GAHV |
| åt | AWT |

These are approximations. Use the play button on a card, or search the word on forvo.com, to hear it.

## Do not use the third form as the past
The third form (gått, sett, köpt) is not the plain past. After a time word like igår you need the past form.

- ~~Jag gått hem igår.~~ → Jag gick hem igår.
- ~~Jag köpt en bok.~~ → Jag köpte en bok.
- ~~Jag sett en film.~~ → Jag såg en film.

## Walk or ride?
| Word | Meaning | Example |
|---|---|---|
| gå | go on foot | Jag gick till affären. |
| åka | go by vehicle | Vi åkte till bergen. |

For a car, bus or plane use åka or resa.

## Questions and the seat rule still apply
| Statement | Question |
|---|---|
| Du tog bussen. | Tog du bussen? |
| Ni såg filmen. | Såg ni filmen? |
| Du hade mycket att göra. | Hade du mycket att göra? |

After a time word the verb stays in seat 2: Igår gick jag hem. I lördags såg vi en film. Förra veckan hade jag mycket att göra.

## Watch out
- Adding -ade to an irregular verb: ~~gåde, ätade, gördade~~ → gick, åt, gjorde.
- Mixing up var and vart: var = was, vart = where to. Igår kväll var jag hemma.
- Forgetting the flip after a time word: ~~Igår jag gick.~~ → Igår gick jag.

## Coming next
skriva (skrev), sitta (satt), stå (stod), bli (blev) and dricka (drack).
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
    // Rewritten with Lesson 5.
    markdown: `# Modals + infinitive

A modal is a helping verb that adds an attitude to another verb: ability, wish, obligation, permission or plan. The modal carries the tense. The second verb is the **plain infinitive, with no att**, and it never changes.

Jag vill äta. Not ~~Jag vill att äta~~, not ~~Jag vill äter~~, not ~~Jag vill åt~~.

| Infinitive | Present | Past | Supine | Meaning |
|---|---|---|---|---|
| kunna | kan | kunde | kunnat | can, be able to, know (a skill) |
| vilja | vill | ville | velat | want to |
| (none) | måste | måste | måst | must, have to |
| skola | ska | skulle | skolat (rare) | going to, shall, is to |
| få | får | fick | fått | may, be allowed to |
| böra | bör | borde | bort (rare) | ought to, should |
| behöva | behöver | behövde | behövt | need to |
| tänka | tänker | tänkte | tänkt | intend to, think |
| bruka | brukar | brukade | brukat | usually do, tend to |

One form for every person: jag kan, du kan, hon kan, vi kan, de kan. Måste does not change in the past, so the context shows the tense: Igår måste jag arbeta *(Yesterday I had to work)*.

## What each one says
- **kan**: ability, possibility or a request. Jag kan simma. Det kan regna. Kan jag få en kaffe? With no second verb it means know a skill: Jag kan lite svenska. *(I know a little Swedish.)*
- **vill**: want to. Jag vill sova. Before a noun it is **vill ha**: Jag vill ha kaffe. Vill gärna is warmer: would like to.
- **ska**: a plan. Imorgon ska jag ringa henne. *(Tomorrow I am going to call her.)* Ska vi gå? *(Shall we go?)* For a pure prediction use kommer att: Det kommer att regna.
- **skulle**: politeness. Jag skulle vilja ha en kaffe. *(I would like a coffee.)* Skulle du kunna hjälpa mig? *(Could you help me?)*
- **bör / borde**: advice. Du borde sova mer. *(You should sleep more.)*
- **brukar**: habits. Jag brukar äta frukost klockan sju. *(I usually eat breakfast at seven.)*
- **tänker**: intention. Jag tänker ringa henne imorgon. *(I intend to call her tomorrow.)*

## måste inte and får inte
| Swedish | Meaning |
|---|---|
| Du måste inte komma. | You do not have to come. |
| Du får inte komma. | You are not allowed to come. |
| Du får komma. | You may come. |
| Jag fick vänta. | I had to wait. |

English "must not" is **får inte**. Kan jag få en kaffe? is the everyday request; Får jag sitta här? asks permission.

## Word order
The modal is the verb in seat 2, and the infinitive goes last. Inte and other adverbs come after the modal, and after the subject if the subject follows the modal.

| Seat 1 | Seat 2 (modal) | Subject / adverb | Rest + infinitive |
|---|---|---|---|
| Jag | vill | | äta middag. |
| Imorgon | ska | jag | träffa min syster. |
| Vi | kan | inte | komma idag. |
| Idag | kan | vi inte | komma. |
| Barnen | ville | också | leka i parken. |
| Vad | vill | du | äta? |

A yes/no question starts with the modal: Kan du komma på söndag? After att the adverb moves before the verb: Jag vet att hon inte kan komma.

## The past
Only the modal goes in the past. The second verb stays in the infinitive.
- Igår kunde jag inte komma. *(Yesterday I could not come.)*
- Barnen ville leka. *(The children wanted to play.)*
- Vi fick inte sitta där. *(We were not allowed to sit there.)*

## Dropping the second verb
| Full form | Normal Swedish | Meaning |
|---|---|---|
| Jag måste gå hem. | Jag måste hem. | I have to go home. |
| Jag ska gå till affären. | Jag ska till affären. | I am going to the store. |
| Hon kan tala svenska. | Hon kan svenska. | She knows Swedish. |

## Watch out
- ~~Jag ska ringde.~~ → Jag ska ringa. Only the modal changes.
- ~~Jag vill kaffe.~~ → Jag vill ha kaffe.
- ~~Imorgon jag kan inte komma.~~ → Imorgon kan jag inte komma.
- **borde** (should) and **bodde** (lived) differ by one letter.
`,
  },
  {
    slug: 'pronouns',
    title: 'Pronouns & possessives',
    // Added with Lesson 5. Sits right after Modals on every device.
    order: 5.5,
    markdown: `# Pronouns & possessives

A pronoun changes form with its job in the sentence: the **subject** form does the action, the **object** form receives it or follows a preposition, and the **possessive** says whose.

| Person | Subject | Object | Possessive (en / ett / plural) |
|---|---|---|---|
| I | jag | mig | min / mitt / mina |
| you (one person) | du | dig | din / ditt / dina |
| he | han | honom | hans |
| she | hon | henne | hennes |
| it (en-word) | den | den | dess (rare) |
| it (ett-word) | det | det | dess (rare) |
| we | vi | oss | vår / vårt / våra |
| you (plural) | ni | er | er / ert / era |
| they | de | dem | deras |

## Object forms
Use the object form after a verb and after a preposition. With a modal, the pronoun comes after the infinitive. With two objects, the person comes first.

| Subject | Object | After a preposition |
|---|---|---|
| Hon ringde. | Jag ringde henne. | Jag pratade med henne. |
| Han kommer. | Vi träffar honom. | Det är en present till honom. |
| De kom. | Jag såg dem i parken. | Vi åt middag med dem. |
| Vi åker. | Kan du hjälpa oss? | Kom med oss! |
| Jag vill. | Kan du ringa mig? | Hon pratade med mig. |

- Jag vill träffa henne. *(I want to meet her.)*
- Han gav mig en bok. *(He gave me a book.)*
- Hon ger honom en present. *(She gives him a present.)*

## den and det
Den replaces an en-word and det replaces an ett-word.
- Jag köpte en bok och läste den. *(I bought a book and read it.)*
- Jag köpte ett äpple och åt det. *(I bought an apple and ate it.)*

Det is also the empty subject: Det regnar. Det är bra. Det går bra. And **att**, not det, joins a clause after säga, tro and veta: Hon sa att hon var trött.

## Possessives agree with the thing owned
| en-word | ett-word | plural |
|---|---|---|
| min fru, min bil, min vän | mitt barn, mitt hus, mitt jobb | mina barn, mina vänner, mina föräldrar |
| din syster | ditt kök | dina böcker |
| vår son | vårt hus | våra barn |

Barn is an ett-word with the same form in singular and plural: **mitt barn** (my child), **mina barn** (my children). Hans, hennes and deras never change: hans bok, hans barn, hennes barn. The noun stays indefinite: min bok, not ~~min boken~~.

## Spoken Swedish
De and dem are both said **dom**, so you choose when you write: De kom. Jag såg dem. You will also hear mej and dej for mig and dig.

## Watch out
- ~~Vad sa honom?~~ → Vad sa hon?
- ~~Jag lekte med min barn.~~ → Jag lekte med mina barn.
- ~~Jag köpte en bok och läste det.~~ → Jag köpte en bok och läste den.
- **honom** has one n and ends in -om. Think HON-OM.
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
