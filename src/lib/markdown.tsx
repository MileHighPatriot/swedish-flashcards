// A small, safe markdown renderer for the grammar notes. It builds React
// elements (never raw HTML), so pasted text cannot inject scripts.
//
// Supports: # headings, paragraphs, - and 1. lists, > quotes, tables,
// **bold**, *italic*, ~~strike~~, `code`, [links](https://…), and --- rules.
//
// Two touches for grammar pages, both written as ordinary tables:
//  - a cell that is just an ending (-te, -de, -ade, -dde) gets a colour chip
//  - a table whose first heading starts with "Seat" is drawn as the
//    seat 1 / seat 2 / seat 3 diagram, with the verb column highlighted

import { Fragment, type ReactNode } from 'react';

const INLINE = /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;

function safeHref(url: string): string | null {
  return /^(https?:\/\/|#\/|mailto:)/i.test(url) ? url : null;
}

export function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{inline(part.slice(2, -2))}</strong>;
    if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) return <del key={i}>{part.slice(2, -2)}</del>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{inline(part.slice(1, -1))}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2]);
      return href ? (
        <a key={i} href={href} {...(href.startsWith('http') ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
          {link[1]}
        </a>
      ) : (
        <Fragment key={i}>{link[1]}</Fragment>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const ENDING = /^-(te|de|ade|dde)$/;

function cell(text: string): ReactNode {
  const t = text.trim();
  const m = ENDING.exec(t);
  if (m) return <span className={`ending ending-${m[1] === 'dde' ? 'de' : m[1]}`}>{t}</span>;
  return inline(t);
}

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

const isTableRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const isRow = (line: string) => line.includes('|');
const LIST = /^\s*(?:[-*•]|\d+[.)])\s+/;

function table(head: string[], rows: string[][], key: number): ReactNode {
  const seats = /^seat\b/i.test(head[0] ?? '');
  const verbCol = head.findIndex((h) => /verb/i.test(h));
  return (
    <div className="md-table-wrap" key={key}>
      <table className={seats ? 'md-table md-seats' : 'md-table'}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className={seats && i === verbCol ? 'md-verb' : undefined}>
                {inline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {head.map((_, i) => (
                <td key={i} className={seats && i === verbCol ? 'md-verb' : undefined} lang={seats ? 'sv' : undefined}>
                  {cell(r[i] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = (['h2', 'h2', 'h3', 'h4'] as const)[level - 1];
      out.push(
        <Tag key={key++} className={level === 1 ? 'md-title' : undefined}>
          {inline(heading[2])}
        </Tag>,
      );
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }
    if (isRow(line) && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && isRow(lines[i])) rows.push(splitRow(lines[i++]));
      out.push(table(head, rows, key++));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={key++}>{inline(quote.join(' '))}</blockquote>);
      continue;
    }
    if (LIST.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST.test(lines[i])) items.push(lines[i++].replace(LIST, ''));
      const Tag = ordered ? 'ol' : 'ul';
      out.push(
        <Tag key={key++}>
          {items.map((it, n) => (
            <li key={n}>{inline(it)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !LIST.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !(isRow(lines[i]) && i + 1 < lines.length && isTableRule(lines[i + 1]))
    )
      para.push(lines[i++].trim());
    out.push(<p key={key++}>{inline(para.join(' '))}</p>);
  }
  return <div className="md">{out}</div>;
}
