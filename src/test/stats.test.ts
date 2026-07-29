import { describe, expect, it } from 'vitest'
import { countWords, readingMinutes } from '../lib/stats'

describe('countWords', () => {
  it('counts nothing in empty or blank text', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
    expect(countWords('\n\n')).toBe(0)
  })

  it('counts a single word regardless of surrounding whitespace', () => {
    expect(countWords('hello')).toBe(1)
    expect(countWords('  hello  ')).toBe(1)
  })

  it('collapses runs of whitespace rather than counting empty strings', () => {
    // The naive `split(' ')` returns empty entries for every extra space, which
    // is how a double-spaced sentence reports twice its real length.
    expect(countWords('one  two   three')).toBe(3)
    expect(countWords('one\ttwo\nthree')).toBe(3)
  })

  it('treats punctuation as part of the word it hangs off', () => {
    expect(countWords('Hello, world!')).toBe(2)
    expect(countWords('well-known example')).toBe(2)
  })

  it('keeps blocks apart, matching textBetween with a space separator', () => {
    // doc.textBetween(…, ' ', ' ') joins blocks with a space, so the last word
    // of one paragraph and the first of the next stay separate.
    expect(countWords('end of one start of two')).toBe(6)
  })
})

describe('readingMinutes', () => {
  it('is zero only for an empty document', () => {
    expect(readingMinutes(0)).toBe(0)
  })

  it('never rounds a non-empty document down to nothing', () => {
    // 3 words is well under a minute at 200wpm, but "0 min" reads as a bug.
    expect(readingMinutes(3)).toBe(1)
    expect(readingMinutes(99)).toBe(1)
  })

  it('scales at 200 words per minute', () => {
    expect(readingMinutes(200)).toBe(1)
    expect(readingMinutes(1000)).toBe(5)
    expect(readingMinutes(1240)).toBe(6)
  })
})
