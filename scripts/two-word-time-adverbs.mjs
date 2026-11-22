// One-off (safe to re-run): rewrite igår / idag / imorgon / ikväll in the seed
// files as two words (i går, i dag, i morgon, i kväll). Same rule as twoWordTime
// in src/lib/timewords.ts. Built-in ids stay the same through
// src/data/seedIdAliases.ts, which the seed-revision test regenerates:
//   WRITE_SEED_ALIASES=1 npx vitest run src/lib/seedRevision.test.ts
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ONE_WORD = /(?<![\p{L}\p{N}])(i)(går|dag|morgon|kväll)(?![\p{L}\p{N}])/giu;
const root = new URL('../seed/', import.meta.url).pathname;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.txt') ? [path] : [];
  });
}

let changed = 0;
for (const file of walk(root)) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(ONE_WORD, '$1 $2');
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
    console.log(`updated ${file.slice(root.length)}`);
  }
}
console.log(`${changed} file(s) changed`);
