// Reads the text of a lesson printable (what `pdftotext -layout lessonN.pdf` gives)
// into its parts: word tables, the story, dialogue and reading, the worksheet
// items, the checklist, the speaking prompt, the report and the answer key.
// Pure functions, no database access. Rule-based: every line of the input ends
// up in a structure, in `skipped` (prose by design) or in `unparsed`.

export interface DocWord {
  line: number;
  /** Without the article: "en familj" is swedish "familj", gender "en". */
  swedish: string;
  english: string;
  gender: 'en' | 'ett' | null;
  verb: { infinitive: string; present: string; past: string; supine: string } | null;
  exampleSv: string;
  exampleEn: string;
}
export interface DocLine {
  speaker: string;
  sv: string;
  en: string;
  /** The printed line number in a Reading table. */
  n: number | null;
}
export interface DocText {
  kind: 'story' | 'dialogue' | 'reading';
  title: string;
  line: number;
  lines: DocLine[];
}
export interface DocItem {
  line: number;
  part: string;
  partTitle: string;
  n: number;
  text: string;
  /** '' unless an answer key supplies it. */
  answer: string;
}
export interface DocCheck {
  line: number;
  question: string;
  answer: string;
}
export interface DocReport {
  title: string;
  paragraphs: string[];
  table: { header: string[]; rows: string[][] } | null;
  patterns: { n: number; title: string; text: string }[];
}
export interface DocSkip {
  line: number;
  raw: string;
  reason: string;
}
export interface LessonDoc {
  number: number | null;
  title: string;
  words: DocWord[];
  texts: DocText[];
  checks: DocCheck[];
  items: DocItem[];
  checklist: string[];
  speakingPrompt: string;
  writingTask: string;
  questions: { sv: string; en: string }[];
  report: DocReport | null;
  answerKey: Record<string, string[]>;
  skipped: DocSkip[];
  unparsed: DocSkip[];
}

/** Flatten runs of spaces to one space, as copying from Preview can produce. Used by tests and nothing else. */
export function flattenSpaces(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' '))
    .join('\n');
}

// ---------- tables ----------

type TableKind = 'pairs' | 'double' | 'example' | 'verbs' | 'verbsType' | 'reading' | 'report' | 'answers';

const HEADERS: Record<string, TableKind> = {
  'swedish|english': 'pairs',
  'swedish|english|swedish|english': 'double',
  'swedish|english|example': 'example',
  'infinitive|present|past|english|third form': 'verbs',
  'infinitive|present|past|type|english': 'verbsType',
  '#|swedish|english': 'reading',
  'part|answers': 'answers',
};
/** The same headers when the columns have collapsed to single spaces. */
const FLAT_HEADERS: Record<string, TableKind> = Object.fromEntries(Object.entries(HEADERS).map(([k, v]) => [k.replace(/\|/g, ' '), v]));
const FLAT_REPORT = /^task type( lesson \d+)+ what it shows$/i;

interface Row {
  cells: string[];
  lines: number[];
}
interface Table {
  kind: TableKind;
  header: string[];
  /** Character offset where each column starts. */
  offs: number[];
  line: number;
  rows: Row[];
  /** Rows are separated by blank lines, so a line right under a row continues it. */
  sparse: boolean | null;
  /** Columns were lost (single spaces): rows cannot be sliced. */
  flat: boolean;
  heading: string;
  subtitle: string;
  lastRowLine: number;
}

interface Seg {
  start: number;
  text: string;
}
function segments(raw: string): Seg[] {
  const out: Seg[] = [];
  const re = /\S+(?: \S+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push({ start: m.index, text: m[0] });
  return out;
}

/** Slice a line by the header's column offsets. Null when it does not line up. */
function fit(offs: number[], raw: string): string[] | null {
  const cells = offs.map(() => '');
  for (const s of segments(raw)) {
    let best = -1;
    for (let c = 0; c < offs.length; c++) if (Math.abs(s.start - offs[c]) <= 2 && (best < 0 || Math.abs(s.start - offs[c]) < Math.abs(s.start - offs[best]))) best = c;
    if (best < 0 || cells[best]) return null;
    // Text that runs into the next column is prose, not a cell.
    if (best < offs.length - 1 && s.start + s.text.length > offs[best + 1] - 1) return null;
    cells[best] = s.text;
  }
  return cells;
}

const SPEAKER = /^([A-ZÅÄÖ][\p{L}-]{0,20}):\s+(.+)$/u;
const sentenceLike = (s: string) => /[.!?…]["”’)]*$/.test(s) || SPEAKER.test(s);

function splitSentences(s: string): string[] {
  return s
    .replace(/([.!?…]+["”’)]*)\s+/g, '$1\n')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** "en familj" → familj + en; "hjälpa (hjälper, hjälpte)" → the verb forms. */
function wordFromCell(line: number, svRaw: string, english: string, exampleSv = ''): DocWord {
  let sv = svRaw.trim();
  let gender: DocWord['gender'] = null;
  let verb: DocWord['verb'] = null;
  const paren = /^(.+?)\s*\(([^()]+)\)$/.exec(sv);
  if (paren) {
    const forms = paren[2]
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    if (forms.length >= 2 && forms.length <= 3 && forms.every((f) => !/\s/.test(f))) {
      sv = paren[1].trim();
      verb = { infinitive: sv, present: forms[0], past: forms[1], supine: forms[2] ?? '' };
    }
  }
  const art = /^(en|ett)\s+(\S.*)$/i.exec(sv);
  if (art && !verb) {
    gender = art[1].toLowerCase() as 'en' | 'ett';
    sv = art[2];
  }
  return { line, swedish: sv, english: english.trim(), gender, verb, exampleSv, exampleEn: '' };
}

/** "1. a 2. b 3. c" → ["a", "b", "c"]; anything else stays one string. */
function splitNumbered(s: string): string[] {
  if (!/^1\.\s/.test(s)) return [s];
  const out: string[] = [];
  let pos = 0;
  for (let k = 1; ; k++) {
    const start = pos + `${k}. `.length;
    const j = s.indexOf(` ${k + 1}. `, start);
    if (j < 0) {
      out.push(s.slice(start).trim());
      break;
    }
    out.push(s.slice(start, j).trim());
    pos = j + 1;
  }
  return out;
}

function textTitle(heading: string): string {
  const m = /^(?:Read the story|Reading|Dialogue|Story)\s*:\s*(.+)$/i.exec(heading);
  return (m ? m[1] : heading).trim();
}

// ---------- the parser ----------

const FOOTER = /^Swedish Plan\s*\|.*\bPage\s+\d+$/i;
const MAJOR = /^(Read this first\b|PART\s+\d+\s*:|Worksheet$|Warm-up\s*:|Part\s+[A-Z]\s*:|Speaking and listening checklist\b|Paste this into Claude\b|Answer key$)/;

type Status = { kind: 'used' } | { kind: 'skipped' | 'unparsed'; reason: string };

interface Part {
  id: string;
  title: string;
  nextItem: number;
  writing: boolean;
}

export interface LessonDocDetail {
  doc: LessonDoc;
  /** 1-based numbers of the lines that went into a structure (headings included). */
  consumed: number[];
  /** Blank lines and page footers. */
  ignored: number[];
}

export function parseLessonDoc(text: string): LessonDoc {
  return parseLessonDocDetailed(text).doc;
}

export function parseLessonDocDetailed(text: string): LessonDocDetail {
  const raws = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\f/g, '').replace(/\t/g, '    ').replace(/\s+$/, ''));

  const doc: LessonDoc = {
    number: null,
    title: '',
    words: [],
    texts: [],
    checks: [],
    items: [],
    checklist: [],
    speakingPrompt: '',
    writingTask: '',
    questions: [],
    report: null,
    answerKey: {},
    skipped: [],
    unparsed: [],
  };

  const status = new Map<number, Status>();
  const ignored: number[] = [];
  const use = (ln: number) => status.set(ln, { kind: 'used' });
  const skip = (ln: number, reason: string) => status.set(ln, { kind: 'skipped', reason });
  const unp = (ln: number, reason: string) => status.set(ln, { kind: 'unparsed', reason });

  let mode: 'lesson' | 'worksheet' = 'lesson';
  let scheme5 = false;
  let lastSectionN: number | null = null;
  let heading = '';
  let lastProse = '';
  let table: Table | null = null;
  let inReport = false;
  let pattern: DocReport['patterns'][number] | null = null;
  let reportParaOpen = false;
  let part: Part | null = null;
  let lastPartN: number | null = null;
  let lastItem: { item: DocItem; line: number } | null = null;
  let inChecklist = false;
  let lastChecklistLine = -1;
  let prompt: 'wait' | 'collect' | null = null;
  const promptLines: string[] = [];
  let pendingCheck: { line: number; question: string; answer: string; lines: number[] } | null = null;
  const writing: string[] = [];
  let flatAnswer: { part: string; text: string; lines: number[] } | null = null;

  const flushFlatAnswer = () => {
    if (flatAnswer) doc.answerKey[flatAnswer.part] = splitNumbered(flatAnswer.text);
    flatAnswer = null;
  };

  const finishTable = () => {
    const t = table;
    table = null;
    flushFlatAnswer();
    if (!t || t.flat) return;
    const bad = (r: Row, reason: string) => r.lines.forEach((l) => unp(l, reason));
    const c = (r: Row, i: number) => r.cells[i] ?? '';
    switch (t.kind) {
      case 'verbs':
      case 'verbsType': {
        const en = t.kind === 'verbs' ? 3 : 4;
        for (const r of t.rows) {
          if (!c(r, 0) || !c(r, 1) || !c(r, 2)) {
            bad(r, 'A verb row needs an infinitive, a present and a past form.');
            continue;
          }
          doc.words.push({
            line: r.lines[0],
            swedish: c(r, 0),
            english: c(r, en),
            gender: null,
            verb: { infinitive: c(r, 0), present: c(r, 1), past: c(r, 2), supine: t.kind === 'verbs' ? c(r, 4) : '' },
            exampleSv: '',
            exampleEn: '',
          });
        }
        break;
      }
      case 'double':
        for (const r of t.rows) {
          let any = false;
          for (const i of [0, 2]) {
            if (c(r, i) && c(r, i + 1)) {
              doc.words.push(wordFromCell(r.lines[0], c(r, i), c(r, i + 1)));
              any = true;
            }
          }
          if (!any) bad(r, 'A word row needs Swedish and English.');
        }
        break;
      case 'example':
        for (const r of t.rows) {
          if (!c(r, 0) || !c(r, 1)) bad(r, 'A word row needs Swedish and English.');
          else doc.words.push(wordFromCell(r.lines[0], c(r, 0), c(r, 1), c(r, 2)));
        }
        break;
      case 'reading': {
        const lines: DocLine[] = [];
        for (const r of t.rows) {
          const n = /^\d+$/.test(c(r, 0)) ? Number(c(r, 0)) : null;
          if (n == null || !c(r, 1)) bad(r, 'A reading row needs a line number and the Swedish.');
          else lines.push({ speaker: '', sv: c(r, 1), en: c(r, 2), n });
        }
        if (lines.length) doc.texts.push({ kind: 'reading', title: textTitle(t.heading), line: t.line, lines });
        break;
      }
      case 'pairs': {
        const rows = t.rows.filter((r) => {
          if (c(r, 0)) return true;
          bad(r, 'The Swedish column is empty.');
          return false;
        });
        const wordsHint = /\bwords?\b/i.test(t.heading) || /\bwords?\b/i.test(t.subtitle);
        const sentences = rows.filter((r) => sentenceLike(c(r, 0))).length;
        const spoken = rows.filter((r) => SPEAKER.test(c(r, 0))).length;
        if (!wordsHint && rows.length > 0 && sentences * 2 >= rows.length) {
          const dialogue = spoken * 2 >= rows.length;
          const lines = rows.map((r): DocLine => {
            const m = dialogue ? SPEAKER.exec(c(r, 0)) : null;
            return { speaker: m ? m[1] : '', sv: m ? m[2] : c(r, 0), en: c(r, 1), n: null };
          });
          doc.texts.push({ kind: dialogue ? 'dialogue' : /^reading\b/i.test(t.heading) ? 'reading' : 'story', title: textTitle(t.heading), line: t.line, lines });
        } else {
          for (const r of rows) {
            if (!c(r, 1)) bad(r, 'A word row needs Swedish and English.');
            else doc.words.push(wordFromCell(r.lines[0], c(r, 0), c(r, 1)));
          }
        }
        break;
      }
      case 'report':
        if (doc.report) doc.report.table = { header: t.header, rows: t.rows.map((r) => r.cells) };
        break;
      case 'answers':
        for (const r of t.rows) {
          if (!c(r, 0) || !c(r, 1)) bad(r, 'An answer-key row needs a part and its answers.');
          else doc.answerKey[c(r, 0)] = splitNumbered(c(r, 1));
        }
        break;
    }
  };

  const endAll = () => {
    finishTable();
    inReport = false;
    pattern = null;
    reportParaOpen = false;
    part = null;
    lastItem = null;
    inChecklist = false;
    prompt = null;
    lastProse = '';
  };

  const startPart = (ln: number, id: string, title: string) => {
    endAll();
    mode = 'worksheet';
    part = { id, title: title.trim(), nextItem: 1, writing: /writing/i.test(title) };
    use(ln);
  };

  const addItem = (ln: number, n: number, textOf: string) => {
    if (!part) return;
    const item: DocItem = { line: ln, part: part.id, partTitle: part.title, n, text: textOf, answer: '' };
    doc.items.push(item);
    part.nextItem = n + 1;
    lastItem = { item, line: ln };
    if (part.writing) writing.push(`${n}. ${textOf}`);
    use(ln);
  };

  const startSection = (ln: number, title: string) => {
    endAll();
    mode = 'lesson';
    heading = title.trim();
    use(ln);
    if (/report/i.test(heading)) {
      inReport = true;
      doc.report ??= { title: heading, paragraphs: [], table: null, patterns: [] };
    }
  };

  const openTable = (ln: number, kind: TableKind, raw: string, flat: boolean) => {
    const segs = segments(raw);
    const subtitle = lastProse.length < 80 && !/[.!?]$/.test(lastProse) ? lastProse : '';
    finishTable();
    table = { kind, header: segs.map((s) => s.text), offs: segs.map((s) => s.start), line: ln, rows: [], sparse: null, flat, heading, subtitle, lastRowLine: -1 };
    if (flat) table.header = HEADERS_BY_KIND[kind] ?? table.header;
    lastProse = '';
    use(ln);
  };

  // ---------- header: "Swedish Lesson N (Day N)" and the topic line ----------
  let start = 0;
  const firstText = raws.findIndex((l) => l.trim() && !FOOTER.test(l.trim()));
  if (firstText >= 0) {
    const m = /^Swedish Lesson\s+(\d+)\b/i.exec(raws[firstText].trim());
    if (m) {
      doc.number = Number(m[1]);
      use(firstText + 1);
      start = firstText + 1;
      const next = raws.findIndex((l, i) => i > firstText && l.trim() !== '' && !FOOTER.test(l.trim()));
      if (next >= 0 && !MAJOR.test(raws[next].trim()) && !/^(Name|Plan)\s*:/i.test(raws[next].trim())) {
        doc.title = raws[next].trim();
        use(next + 1);
      }
    }
  }

  let blank = false;
  for (let i = start; i < raws.length; i++) {
    const raw = raws[i];
    const t = raw.trim();
    const ln = i + 1;
    if (!t || FOOTER.test(t)) {
      ignored.push(ln);
      blank = true;
      if (prompt === 'collect') prompt = null;
      continue;
    }
    const prevBlank = blank;
    blank = false;
    if (status.has(ln)) continue; // the topic line

    const major = MAJOR.test(t);

    // The speaking prompt: the paragraph under its heading.
    if (prompt && !major) {
      promptLines.push(t);
      prompt = 'collect';
      use(ln);
      continue;
    }
    // A "(answer: ...)" that wrapped onto the next line.
    if (pendingCheck) {
      if (!major) {
        pendingCheck.answer += ` ${t}`;
        pendingCheck.lines.push(ln);
        use(ln);
        if (/\)$/.test(t)) {
          doc.checks.push({ line: pendingCheck.line, question: pendingCheck.question, answer: pendingCheck.answer.slice(0, -1).trim() });
          pendingCheck = null;
        }
        continue;
      }
      pendingCheck.lines.forEach((l) => unp(l, 'The "(answer: ...)" never closed.'));
      pendingCheck = null;
    }

    // ---------- headings that name a part of the printable ----------
    let m: RegExpExecArray | null;
    if (/^Read this first\b/.test(t)) {
      endAll();
      mode = 'lesson';
      heading = t;
      use(ln);
      continue;
    }
    if ((m = /^PART\s+(\d+)\s*:\s*(.*)$/.exec(t))) {
      endAll();
      scheme5 = true;
      mode = /worksheet/i.test(m[2]) ? 'worksheet' : 'lesson';
      lastPartN = null;
      heading = m[2].trim();
      use(ln);
      continue;
    }
    if (t === 'Worksheet') {
      endAll();
      mode = 'worksheet';
      use(ln);
      continue;
    }
    if ((m = /^Warm-up\s*:\s*(.*)$/.exec(t))) {
      startPart(ln, 'Warm-up', m[1]);
      continue;
    }
    if ((m = /^Part\s+([A-Z])\s*:\s*(.*)$/.exec(t))) {
      startPart(ln, m[1], m[2]);
      continue;
    }
    if (/^Speaking and listening checklist\b/.test(t)) {
      endAll();
      inChecklist = true;
      use(ln);
      continue;
    }
    if (/^Paste this into Claude\b/.test(t)) {
      endAll();
      prompt = 'wait';
      use(ln);
      continue;
    }
    if (t === 'Answer key') {
      endAll();
      mode = 'lesson';
      heading = t;
      use(ln);
      continue;
    }

    // A wrapped table cell can start with "10. ...": it belongs to the row above, not to a new section.
    if (table) {
      const tb = table as Table;
      if (tb.flat) {
        const open = flatAnswer as { part: string; text: string; lines: number[] } | null;
        if (tb.kind === 'answers' && open && !prevBlank) {
          open.text += ` ${t}`;
          open.lines.push(ln);
          use(ln);
          continue;
        }
      } else if (tb.lastRowLine === ln - 1 && tb.rows.length > 0) {
        const cells = fit(tb.offs, raw);
        if (cells && cells[0] === '') {
          const prev = tb.rows[tb.rows.length - 1];
          cells.forEach((cell, c) => {
            if (cell) prev.cells[c] = prev.cells[c] ? `${prev.cells[c]} ${cell}` : cell;
          });
          prev.lines.push(ln);
          tb.lastRowLine = ln;
          use(ln);
          continue;
        }
      }
    }

    // ---------- numbered lines: a section, a worksheet part, an item, a check or a pattern ----------
    if ((m = /^(\d+)\.\s+(\S.*)$/.exec(t))) {
      const n = Number(m[1]);
      const rest = m[2];
      const check = /^(.*?)\s*\(answer:\s*(.*)$/i.exec(rest);
      if (check) {
        finishTable();
        use(ln);
        if (/\)$/.test(check[2])) doc.checks.push({ line: ln, question: check[1], answer: check[2].slice(0, -1).trim() });
        else pendingCheck = { line: ln, question: check[1], answer: check[2], lines: [ln] };
        continue;
      }
      if (mode === 'worksheet') {
        if (!scheme5) {
          if (part) addItem(ln, n, rest);
          else skip(ln, 'A numbered line outside a worksheet part.');
          continue;
        }
        const itemLike = /[.?!]$/.test(rest) || /_{3,}/.test(rest);
        const nextPart: number = ((lastPartN as number | null) ?? 0) + 1;
        const current = part as Part | null;
        let isItem: boolean;
        if (!current) isItem = false;
        else if (itemLike) isItem = !(n !== current.nextItem && n === nextPart);
        else if (n === nextPart) isItem = false;
        else isItem = n === current.nextItem;
        if (isItem) addItem(ln, n, rest);
        else {
          startPart(ln, String(n), rest);
          lastPartN = n;
        }
        continue;
      }
      if (inReport && doc.report && (scheme5 || !(lastSectionN == null || n > lastSectionN))) {
        finishTable();
        pattern = { n, title: rest, text: '' };
        doc.report.patterns.push(pattern);
        use(ln);
        continue;
      }
      if (!scheme5 && (lastSectionN == null || n > lastSectionN)) {
        lastSectionN = n;
        startSection(ln, rest);
        continue;
      }
      // A numbered list inside the lesson text: prose (unless a table claims it below).
    } else if (mode === 'worksheet' && scheme5 && (m = /^(\d+)([A-Z])\.\s+(\S.*)$/.exec(t))) {
      startPart(ln, m[1] + m[2], m[3]);
      lastPartN = Number(m[1]);
      continue;
    } else if (mode === 'lesson' && (m = /^([A-Z]\d*)\.\s+(\S.*)$/.exec(t))) {
      scheme5 = true;
      startSection(ln, m[2]);
      continue;
    }

    // ---------- tables ----------
    const segs = segments(raw);
    const key = segs.map((s) => s.text.toLowerCase()).join('|');
    const flatKey = t.replace(/\s+/g, ' ').toLowerCase();
    if (HEADERS[key]) {
      openTable(ln, HEADERS[key], raw, false);
      continue;
    }
    if (segs.length === 1 && (FLAT_HEADERS[flatKey] || FLAT_REPORT.test(flatKey))) {
      openTable(ln, FLAT_HEADERS[flatKey] ?? 'report', raw, true);
      continue;
    }
    if (inReport && doc.report && !doc.report.table && !table && !pattern && segs.length >= 3) {
      openTable(ln, 'report', raw, false);
      continue;
    }

    if (table) {
      const tb = table as Table;
      if (tb.flat) {
        const tokens = t.split(' ');
        if ((tb.kind === 'verbs' || tb.kind === 'verbsType') && tokens.length === 5) {
          const en = tb.kind === 'verbs' ? 3 : 4;
          doc.words.push({
            line: ln,
            swedish: tokens[0],
            english: tokens[en],
            gender: null,
            verb: { infinitive: tokens[0], present: tokens[1], past: tokens[2], supine: tb.kind === 'verbs' ? tokens[4] : '' },
            exampleSv: '',
            exampleEn: '',
          });
          use(ln);
        } else if (tb.kind === 'answers') {
          const row = /^([A-Z]|\d+[A-Z]?)\s+(\S.*)$/.exec(t);
          const open = flatAnswer as { part: string; text: string; lines: number[] } | null;
          if (row && (prevBlank || !open)) {
            flushFlatAnswer();
            flatAnswer = { part: row[1], text: row[2], lines: [ln] };
            use(ln);
          } else if (open) {
            open.text += ` ${t}`;
            open.lines.push(ln);
            use(ln);
          } else unp(ln, 'An answer-key line with no part in front of it.');
        } else unp(ln, 'The table columns were lost (single spaces), so this row cannot be split.');
        continue;
      }
      const cells = fit(tb.offs, raw);
      if (cells) {
        const filled = cells.filter(Boolean).length;
        const prev = tb.rows[tb.rows.length - 1];
        if (prev && tb.lastRowLine === ln - 1 && (cells[0] === '' || tb.sparse)) {
          cells.forEach((cell, c) => {
            if (cell) prev.cells[c] = prev.cells[c] ? `${prev.cells[c]} ${cell}` : cell;
          });
          prev.lines.push(ln);
          tb.lastRowLine = ln;
          use(ln);
          continue;
        }
        if (cells[0] && (filled >= 2 || tb.offs.length === 1)) {
          if (tb.sparse === null) tb.sparse = prevBlank;
          tb.rows.push({ cells, lines: [ln] });
          tb.lastRowLine = ln;
          use(ln);
          continue;
        }
      } else if (tb.rows.length > 0 && /\S {3,}\S/.test(raw)) {
        unp(ln, 'This row does not line up with the table columns.');
        continue;
      }
      finishTable();
    }

    // ---------- what is left belongs to the part of the printable we are in ----------
    if (inChecklist) {
      const box = /^\[\s*[xX✓]?\s*\]\s*(.+)$/.exec(t);
      if (box) {
        doc.checklist.push(box[1].trim());
        lastChecklistLine = ln;
        use(ln);
      } else if (lastChecklistLine === ln - 1 && doc.checklist.length) {
        doc.checklist[doc.checklist.length - 1] += ` ${t}`;
        lastChecklistLine = ln;
        use(ln);
      } else skip(ln, 'Text in the checklist that is not a checkbox line.');
      continue;
    }
    if (inReport && doc.report) {
      const p = pattern as DocReport['patterns'][number] | null;
      if (p) p.text = p.text ? `${p.text}${prevBlank ? '\n' : ' '}${t}` : t;
      else if (reportParaOpen && !prevBlank) doc.report.paragraphs[doc.report.paragraphs.length - 1] += ` ${t}`;
      else doc.report.paragraphs.push(t);
      reportParaOpen = true;
      use(ln);
      continue;
    }
    if (mode === 'worksheet' && part) {
      const current = part as Part;
      const li = lastItem as { item: DocItem; line: number } | null;
      if (li && li.line === ln - 1) {
        li.item.text += ` ${t}`;
        li.line = ln;
        if (current.writing) writing[writing.length - 1] += ` ${t}`;
        use(ln);
      } else {
        if (current.writing) writing.push(t);
        skip(ln, 'Worksheet instruction.');
      }
      continue;
    }
    lastProse = t;
    skip(ln, 'Lesson text.');
  }
  finishTable();
  if (pendingCheck) (pendingCheck as { lines: number[] }).lines.forEach((l) => unp(l, 'The "(answer: ...)" never closed.'));

  doc.speakingPrompt = promptLines.join(' ');
  doc.writingTask = writing.join('\n');

  // Answer-key answers go onto the worksheet items of the same part and number.
  for (const item of doc.items) {
    const answers = doc.answerKey[item.part];
    if (answers && answers.length > 1 && answers[item.n - 1]) item.answer = answers[item.n - 1];
  }

  // Conversation questions: the Swedish sentences that end in "?".
  const seen = new Set<string>();
  for (const text of doc.texts) {
    for (const l of text.lines) {
      const sv = splitSentences(l.sv);
      const en = splitSentences(l.en);
      sv.forEach((s, k) => {
        if (!/\?["”’)]*$/.test(s) || seen.has(s)) return;
        seen.add(s);
        doc.questions.push({ sv: s, en: en.length === sv.length ? en[k] : l.en });
      });
    }
  }

  const consumed: number[] = [];
  for (const [ln, s] of [...status.entries()].sort((a, b) => a[0] - b[0])) {
    if (s.kind === 'used') consumed.push(ln);
    else (s.kind === 'skipped' ? doc.skipped : doc.unparsed).push({ line: ln, raw: raws[ln - 1], reason: s.reason });
  }
  return { doc, consumed, ignored };
}

const HEADERS_BY_KIND: Partial<Record<TableKind, string[]>> = Object.fromEntries(Object.entries(HEADERS).map(([k, v]) => [v, k.split('|')]));
