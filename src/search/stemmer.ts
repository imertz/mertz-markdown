import { stemmer as stemEnglish } from '@zbsearch/stemmers/english'
import { stemmer as stemGreek } from '@zbsearch/stemmers/greek'

/**
 * The stemmer the index and the snippet highlighter both run on.
 *
 * ZBSearch's `multilingual` tokenizer segments and lowercases every script
 * correctly but does no stemming at all, which the vendor measures at ~0.70
 * recall@10 against ~0.98 for a tuned single-language install. Handing it real
 * stemmers closes most of that gap without giving up the one-index, one-BM25
 * property that makes results comparable: two indexes would mean merging two
 * independently normalised score spaces at query time, which cannot be done
 * honestly.
 *
 * It also fixes something the docs get wrong. `multilingual` claims to fold
 * diacritics, but its table covers charCodes 192-383 plus a few Cyrillic and
 * Arabic letters — every accented Greek vowel sits above that range, so
 * `καφες` found nothing against `καφές`. The Greek stemmer's *first* step is a
 * normalisation table mapping `ά έ ή ί ό ύ ώ` to bare vowels and `ς` to `σ`,
 * so accent-insensitivity falls out of it doing its actual job. Both halves are
 * pinned in `src/test/search-language.test.ts`.
 */

/**
 * One Greek letter is enough to route the token: by the time a stemmer sees a
 * token the tokenizer has already split on word boundaries, so scripts do not
 * mix inside it.
 */
const GREEK = /\p{Script=Greek}/u

/**
 * ZBSearch applies this to indexed text and to query terms alike, which is what
 * makes the two sides symmetric — a property the highlighter depends on too.
 */
export const stemToken = (token: string): string =>
  GREEK.test(token) ? stemGreek(token) : stemEnglish(token)
