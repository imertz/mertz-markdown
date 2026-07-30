import { tokenOf } from './tokenizer'

/**
 * Excerpting a passage around the words the query actually matched.
 *
 * ZBSearch returns documents and scores, never offsets, so the excerpt has to
 * be rebuilt here. The trap is doing it with `indexOf`: the engine matched
 * `running` against `run` and `καφές` against `καφες`, so a substring search
 * finds nothing to mark and the row shows a snippet with no visible reason for
 * being there. Stemming is not reversible either — you cannot map a stem back
 * onto surface text by searching for it.
 *
 * So do what the engine did, over words rather than characters: segment, run
 * each word through the *same* tokenizer, and mark the ones whose token appears
 * in the query. Case, accents, final sigma and inflection all fall out of that
 * for free, and offsets come from the segmenter rather than from rewriting the
 * string, so no index map is needed.
 */

/** Same contract as `fuzzyMatch`, so `segments()` renders both. */
export interface Snippet {
  text: string
  matched: number[]
}

interface Word {
  start: number
  end: number
  value: string
}

/** Roughly a line either side of the hit. */
const DEFAULT_RADIUS = 90
const ELLIPSIS = '…'

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null

/**
 * Words with their offsets.
 *
 * Mirrors ZBSearch's own `splitMultilingual`, including its fallback for
 * runtimes without `Intl.Segmenter`, so word boundaries agree with the index.
 */
function words(text: string): Word[] {
  const found: Word[] = []

  if (segmenter) {
    for (const part of segmenter.segment(text)) {
      if (!part.isWordLike) continue
      found.push({
        start: part.index,
        end: part.index + part.segment.length,
        value: part.segment,
      })
    }
    return found
  }

  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (match.index === undefined) continue
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      value: match[0],
    })
  }
  return found
}

/** Grow a window out to the nearest word edges, so it never cuts mid-word. */
function snapOut(text: string, all: Word[], from: number, to: number) {
  let start = from
  let end = to
  for (const word of all) {
    if (word.start < from && word.end > from) start = Math.min(start, word.start)
    if (word.start < to && word.end > to) end = Math.max(end, word.end)
  }
  return { start: Math.max(0, start), end: Math.min(text.length, end) }
}

export function buildSnippet(
  text: string,
  query: string,
  radius: number = DEFAULT_RADIUS,
): Snippet {
  const wanted = new Set(
    words(query)
      .map(word => tokenOf(word.value))
      .filter(Boolean),
  )

  const all = words(text)
  const hits = wanted.size
    ? all.filter(word => wanted.has(tokenOf(word.value)))
    : []

  // Nothing to centre on — show the opening, which is still the most useful
  // part of a passage the engine matched on something we could not localise.
  if (!hits.length) {
    const clipped = text.length > radius * 2
    return {
      text: clipped ? `${text.slice(0, radius * 2).trimEnd()}${ELLIPSIS}` : text,
      matched: [],
    }
  }

  const focus = hits[0]
  const window = snapOut(
    text,
    all,
    focus.start - radius,
    Math.max(focus.end, focus.start - radius + radius * 2),
  )

  const head = window.start > 0 ? ELLIPSIS : ''
  const tail = window.end < text.length ? ELLIPSIS : ''
  const body = text.slice(window.start, window.end)

  // Offsets are into the returned string, so account for a leading ellipsis.
  const shift = head.length - window.start
  const matched: number[] = []
  for (const hit of hits) {
    if (hit.start < window.start || hit.end > window.end) continue
    for (let i = hit.start; i < hit.end; i += 1) matched.push(i + shift)
  }

  return { text: `${head}${body}${tail}`, matched }
}
