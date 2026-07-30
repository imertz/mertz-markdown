import { tokenizer } from 'zbsearch/components'
import { stemToken } from './stemmer'

/**
 * One tokenizer, shared by the index and the snippet highlighter.
 *
 * The highlighter has to decide which words in a passage to mark, and the only
 * correct answer is "the ones the engine matched on". Reimplementing the
 * pipeline — lowercase, fold diacritics, stem — would mean maintaining a second
 * copy of upstream's rules and quietly drifting from them: ZBSearch folds a few
 * letters (ø, đ, ł) that have no canonical decomposition, so an approximation
 * would silently stop marking those.
 *
 * Handing the same instance to `create` instead means there is only ever one
 * pipeline. `create` accepts either a config object or a built tokenizer, and
 * passing the built one is what makes the sharing real rather than coincidental.
 */
export const searchTokenizer = tokenizer.createTokenizer({
  language: 'multilingual',
  stemmer: stemToken,
})

/**
 * The canonical index token for a single word.
 *
 * Empty when the word normalises away entirely — punctuation, or a stop-word if
 * one is ever configured — which callers should read as "not markable".
 */
export function tokenOf(word: string): string {
  return searchTokenizer.tokenize(word, undefined, '')[0] ?? ''
}
