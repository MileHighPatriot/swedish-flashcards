// The database side of a lesson import: what is saved besides the cards.

import { db } from '../db/db';
import { createGrammarPage, getGrammarPage, listTexts, recordWrong, saveLesson, saveText, slugify, updateGrammarPage } from '../db/repo';
import type { ImportText, LessonImport } from './lessonImport';
import { isActive, mistakeKey, type WrongInput } from './mistakeItems';
import { parseText } from './texts';

export interface ExtrasResult {
  texts: number;
  lesson: boolean;
  report: boolean;
}

/**
 * Save the texts, the lesson row and the report page of a printable. Importing
 * the same lesson again updates all three in place: a text is matched on its
 * title, the lesson on its number, the report on its page.
 */
export async function saveLessonExtras(imp: LessonImport, texts: ImportText[]): Promise<ExtrasResult> {
  const mine = await listTexts();
  let saved = 0;
  for (const t of texts) {
    if (!t.body.trim()) continue;
    const title = parseText(t.body, 'draft', false, t.title).title;
    const label = imp.number != null ? `Lesson ${imp.number}: ${title}` : title;
    await saveText({ id: mine.find((x) => x.title === label)?.id, title: label, body: t.body });
    saved++;
  }
  if (imp.lesson) await saveLesson(imp.lesson);
  if (imp.reportPage) {
    const page = await getGrammarPage(slugify(imp.reportPage.title));
    if (page) await updateGrammarPage(page.id, { markdown: imp.reportPage.markdown });
    else await createGrammarPage(imp.reportPage.title, imp.reportPage.markdown);
  }
  return { texts: saved, lesson: !!imp.lesson, report: !!imp.reportPage };
}

/** Put marked-worksheet fixes on "My mistakes". One that is already on the list is left as it is. */
export async function saveFixMistakes(inputs: WrongInput[]): Promise<number> {
  let added = 0;
  for (const input of inputs) {
    const key = mistakeKey(input.correct, input.cardId, input.prompt);
    const have = (await db.mistakeItems.where('key').equals(key).toArray()).find(isActive);
    if (have) continue;
    await recordWrong(input);
    added++;
  }
  return added;
}
