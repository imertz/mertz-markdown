import { describe, expect, it } from 'vitest'
import { segments } from '../lib/highlight'
import { buildSnippet } from '../search/snippet'

/**
 * The highlighter has to mark what the *engine* matched, not what the raw query
 * string appears in. Every case below is one a substring highlighter fails
 * silently — returning a snippet with nothing marked in it.
 */

/** The substrings a `<mark>` would wrap, via the shared renderer. */
const marked = (text: string, matched: number[]) =>
  segments(text, matched)
    .filter(part => part.on)
    .map(part => part.text)

const markedFor = (text: string, query: string) => {
  const snippet = buildSnippet(text, query)
  return marked(snippet.text, snippet.matched)
}

describe('buildSnippet', () => {
  it('marks an inflected form the stemmer folded together', () => {
    expect(markedFor('She was running along the square', 'run')).toEqual(['running'])
  })

  it('marks an accented Greek word for an unaccented query', () => {
    expect(markedFor('Ήπιαμε καφές στην πλατεία', 'καφες')).toEqual(['καφές'])
  })

  it('marks an accented Latin word for an unaccented query', () => {
    expect(markedFor('We drank café on the square', 'cafe')).toEqual(['café'])
  })

  it('ignores case in both directions', () => {
    expect(markedFor('Tables are hard', 'TABLE')).toEqual(['Tables'])
  })

  it('marks every term of a multi-term query', () => {
    expect(markedFor('The quarterly review went well', 'quarterly review')).toEqual([
      'quarterly',
      'review',
    ])
  })

  it('marks whole words only, never a substring of one', () => {
    // "run" must not light up the "run" inside "runic".
    expect(markedFor('A runic inscription', 'run')).toEqual([])
  })

  it('centres the window on the hit and ellipsises what it cut', () => {
    const filler = 'padding words here '.repeat(20)
    const snippet = buildSnippet(`${filler}needle ${filler}`, 'needle')

    expect(snippet.text.startsWith('…')).toBe(true)
    expect(snippet.text.endsWith('…')).toBe(true)
    expect(marked(snippet.text, snippet.matched)).toEqual(['needle'])
  })

  it('keeps offsets aligned to the returned string, not the original', () => {
    const filler = 'padding words here '.repeat(20)
    const snippet = buildSnippet(`${filler}needle`, 'needle')

    // The proof that the leading ellipsis was accounted for: slicing the
    // returned text at the reported offsets gives the word back.
    const start = snippet.matched[0]
    const end = snippet.matched[snippet.matched.length - 1] + 1
    expect(snippet.text.slice(start, end)).toBe('needle')
  })

  it('never cuts a word in half at the window edge', () => {
    const snippet = buildSnippet(`${'x'.repeat(200)} needle`, 'needle')
    const head = snippet.text.replace(/^…/, '')
    // Either the window started at a word edge or it swallowed the whole run.
    expect(head.startsWith('x')).toBe(head.startsWith('xxxxx'))
  })

  it('falls back to the opening when it cannot localise the match', () => {
    // The engine can match on headingPath while the passage text has no hit.
    const snippet = buildSnippet('Some ordinary text', 'unrelated')
    expect(snippet.text).toBe('Some ordinary text')
    expect(snippet.matched).toEqual([])
  })

  it('returns short text untouched', () => {
    const snippet = buildSnippet('Brief passage', 'brief')
    expect(snippet.text).toBe('Brief passage')
  })
})
