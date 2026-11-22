// From a parsed lesson printable (lessonDoc.ts) to what the Add screen shows
// and saves: cards, reading texts, the lesson row and the weak-spot report.
// Also the extras of a flashcard block: lesson and week tags, and "My mistakes"
// items from a fix-only block. Nothing here invents content: it only moves
// what the lesson says into the app's own shapes.

import { emptyDraft, type Draft, type Lesson, type LessonReport } from '../db/types';
import { groupLesson, pad2, type DraftGroup, type PlanGroup } from './importer';
import type { DocItem, DocText, LessonDoc } from './lessonDoc';
import type { WrongInput } from './mistakeItems';
import type { ParseResult, ParsedSection, SectionHint } from './parser';
import { splitHint } from './parser';
import { lessonTagOf, weekForLesson, weekTagOf } from './plan';

/** Every imported card is tagged with its lesson and its plan week (from the Week Map). */
export function lessonTags(lessonNumber: number | null): string[] {
  return lessonNumber == null ? [] : [lessonTagOf(lessonNumber), weekTagOf(weekForLesson(lessonNumber))];
}

/** A block that holds nothing but "Fix the error" lines: my marked worksheet coming back. */
export function isFixOnly(parsed: ParseResult): boolean {
  const kinds = parsed.sections.flatMap((s) => s.items.flatMap((i) => (i.draft ? [i.draft.kind] : [])));
  return kinds.length > 0 && kinds.every((k) => k === 'fix');
}

/** One "My mistakes" item per fix line that is being saved. */
export function mistakesFromFixes(plan: PlanGroup[]): WrongInput[] {
  return plan.flatMap((g) =>
    g.rows.flatMap((r) => {
      const gr = r.draft.grammar;
      if (r.action === 'skip' || r.draft.kind !== 'fix' || !gr) return [];
      const wrong = splitHint(gr.prompt).text;
      return [{ prompt: `Fix this sentence: ${wrong}`, typed: wrong, correct: gr.answer, reason: gr.explanation, tags: r.draft.tags, cardId: null, noteId: null, source: 'marked-worksheet' }];
    }),
  );
}

// ---------- the printable ----------

export interface ImportText {
  kind: DocText['kind'];
  title: string;
  /** In the seed/texts line format, question lines included. Editable in the preview. */
  body: string;
}

export interface NeedsAnswer {
  key: string;
  line: number;
  kind: 'fix' | 'translate';
  label: string;
  text: string;
  answer: string;
}

export interface LessonImport {
  number: number | null;
  title: string;
  groups: DraftGroup[];
  texts: ImportText[];
  /** Worksheet items that could be cards but have no answer in the file. Saved only if I fill them in. */
  needs: NeedsAnswer[];
  /** Worksheet items of other kinds (fill-ins, sorting, writing): listed, never saved. */
  notImported: DocItem[];
  lesson: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> | null;
  reportPage: { title: string; markdown: string } | null;
  skipped: LessonDoc['skipped'];
  unparsed: LessonDoc['unparsed'];
}

const kindOfPart = (title: string): 'fix' | 'translate' | 'question' | 'other' =>
  /\bfix\b|find and fix/i.test(title) ? 'fix' : /translat/i.test(title) ? 'translate' : /answer in swedish|reading|questions?\b/i.test(title) ? 'question' : 'other';

function vocabDraft(swedish: string, english: string): Draft {
  const d = emptyDraft('vocab');
  d.swedish = swedish;
  d.english = english;
  d.pos = /\s/.test(swedish) ? 'phrase' : 'other';
  return d;
}

function grammarDraft(kind: 'rule' | 'fix' | 'translate', prompt: string, answer: string, explanation = ''): Draft {
  const d = emptyDraft(kind);
  d.grammar = { prompt, answer, explanation, topic: null };
  return d;
}

export function reportMarkdown(title: string, r: LessonReport): string {
  const out = [`# ${title}`, '', ...r.paragraphs.flatMap((p) => [p, ''])];
  if (r.table) {
    out.push(`| ${r.table.header.join(' | ')} |`, `|${r.table.header.map(() => '---').join('|')}|`);
    for (const row of r.table.rows) out.push(`| ${row.join(' | ')} |`);
    out.push('');
  }
  for (const p of r.patterns) out.push(`${p.n}. **${p.title}** ${p.text}`.trim());
  return out.join('\n').trim() + '\n';
}

function textBody(number: number | null, t: DocText, questions: DocItem[]): string {
  const head = `# ${number != null ? `Lesson ${pad2(number)} – ` : ''}${t.title}`;
  const lines = t.lines.map((l) => (l.speaker ? `${l.speaker} | ${l.sv} | ${l.en}` : `${l.sv} | ${l.en}`));
  // "? question | answer | line": the answer is mine to fill in before saving.
  const qs = questions.map((q) => `? ${q.text} | ${q.answer} | `);
  return [head, ...lines, ...qs].join('\n');
}

/** Turn a parsed printable into an import. `number` overrides the one in the file. */
export function buildLessonImport(doc: LessonDoc, number: number | null = doc.number, name = doc.title): LessonImport {
  const section = (heading: string, hint: SectionHint, drafts: { draft: Draft; line: number }[]): ParsedSection => ({
    heading,
    hint,
    items: drafts.map(({ draft, line }) => ({ line, raw: '', draft, error: null, warnings: [] })),
  });

  const words = doc.words.map((w) => {
    const d = vocabDraft(w.swedish, w.english);
    if (w.gender) {
      d.noun = { gender: w.gender, definite: '', plural: '' };
      d.pos = 'noun';
    }
    if (w.verb) {
      d.verb = { ...w.verb, infinitive: w.verb.infinitive || w.swedish };
      d.pos = 'verb';
    }
    d.exampleSv = w.exampleSv;
    d.exampleEn = w.exampleEn;
    return { draft: d, line: w.line };
  });

  // My own lines in the dialogues are the phrases worth owning.
  const phrases = doc.texts
    .filter((t) => t.kind === 'dialogue')
    .flatMap((t) => t.lines.filter((l) => l.speaker === 'Du' && l.sv && l.en).map((l) => ({ draft: { ...vocabDraft(l.sv, l.en), pos: 'phrase' as const }, line: t.line })));

  const rules = doc.checks.filter((c) => c.answer).map((c) => ({ draft: grammarDraft('rule', c.question, c.answer), line: c.line }));

  const answered: { draft: Draft; line: number }[] = [];
  const needs: NeedsAnswer[] = [];
  const questions: DocItem[] = [];
  const notImported: DocItem[] = [];
  for (const item of doc.items) {
    const kind = kindOfPart(item.partTitle);
    if (kind === 'question') questions.push(item);
    else if (kind === 'other') notImported.push(item);
    else if (item.answer) answered.push({ draft: grammarDraft(kind, item.text, item.answer), line: item.line });
    else needs.push({ key: `${item.part}:${item.n}:${item.line}`, line: item.line, kind, label: `${item.part} ${item.n}`.trim(), text: item.text, answer: '' });
  }

  const parsed: ParseResult = {
    sections: [section('Vocab', 'vocab', words), section('Phrases', 'phrases', phrases), section('Grammar rules', 'rule', rules), section('Worksheet', null, answered)].filter((s) => s.items.length),
    errors: [],
    count: words.length + phrases.length + rules.length + answered.length,
  };

  // Worksheet questions about the text go on the story or reading they ask about (the last one, when there are several).
  const target = [...doc.texts].reverse().find((t) => t.kind === 'reading') ?? [...doc.texts].reverse().find((t) => t.kind === 'story');
  const texts = doc.texts.map((t) => ({ kind: t.kind, title: t.title, body: textBody(number, t, t === target ? questions : []) }));

  const title = number != null ? `Lesson ${pad2(number)} report` : 'Lesson report';
  return {
    number,
    title: name,
    groups: groupLesson(parsed, number, name),
    texts,
    needs,
    notImported: target ? notImported : [...notImported, ...questions],
    lesson:
      number == null
        ? null
        : { number, week: weekForLesson(number), title: name, checklist: doc.checklist, speakingPrompt: doc.speakingPrompt, writingTask: doc.writingTask, questions: doc.questions, report: doc.report },
    reportPage: doc.report ? { title, markdown: reportMarkdown(title, doc.report) } : null,
    skipped: doc.skipped,
    unparsed: doc.unparsed,
  };
}

/** The cards I gave an answer to in the preview. */
export function needsToGroup(needs: NeedsAnswer[], number: number | null, name: string): DraftGroup[] {
  const filled = needs.filter((n) => n.answer.trim());
  if (!filled.length) return [];
  const parsed: ParseResult = {
    sections: [{ heading: 'Worksheet', hint: null, items: filled.map((n) => ({ line: n.line, raw: '', draft: grammarDraft(n.kind, n.text, n.answer.trim()), error: null, warnings: [] })) }],
    errors: [],
    count: filled.length,
  };
  return groupLesson(parsed, number, name);
}

/** Does this text look like a lesson printable rather than a list of cards? */
export function looksLikePrintable(text: string): boolean {
  return /^\s*(?:\f)?\s*Swedish Lesson\s+\d+/im.test(text) || /Speaking and listening checklist|PART 1: LESSON TEXT|Read this first: the lesson|Check yourself before the worksheet/i.test(text);
}
