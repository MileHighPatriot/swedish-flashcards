// The time adverbs that Swedish writes both as one word and as two: igår / i går,
// idag / i dag, imorgon / i morgon, ikväll / i kväll. The app shows and teaches
// the two-word form and treats both as the same answer. ("i morse" is always two
// words, so "imorse" is deliberately not here.)

const ONE_WORD = /(?<![\p{L}\p{N}])(i)(går|dag|morgon|kväll)(?![\p{L}\p{N}])/giu;

/** "Igår kväll" → "I går kväll". Text that already uses two words is returned unchanged. */
export function twoWordTime(text: string): string {
  return text.replace(ONE_WORD, '$1 $2');
}

const ONE_WORD_TYPED = /(?<![\p{L}\p{N}])(i)(g[åa]r|dag|morgon|kv[äa]ll)(?![\p{L}\p{N}])/giu;

/** The same for a typed answer, where å and ä may have been typed as a ("igar"). */
export function twoWordTimeTyped(text: string): string {
  return text.replace(ONE_WORD_TYPED, '$1 $2');
}
