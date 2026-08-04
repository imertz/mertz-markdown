import { describe, expect, it } from 'vitest'
import { slugify, slugsFor } from '../markdown/slug'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('The Founding Decree')).toBe('the-founding-decree')
  })

  it('drops punctuation but keeps hyphens already in the text', () => {
    expect(slugify('Find, replace & go — part two')).toBe(
      'find-replace--go--part-two',
    )
    expect(slugify('Re-entry')).toBe('re-entry')
  })

  it('trims the ends but maps interior spaces one-for-one', () => {
    // Deliberately not collapsed — see normalize. GitHub emits one hyphen per
    // space, and an anchor that is prettier than GitHub's is an anchor that
    // does not resolve there.
    expect(slugify('  spaced   out  ')).toBe('spaced---out')
  })

  it('keeps non-Latin letters rather than erasing the heading', () => {
    // The app ships Greek fonts and a Greek webfont subset; an ASCII-only
    // filter would reduce this to the empty string.
    expect(slugify('Καλημέρα κόσμε')).toBe('καλημέρα-κόσμε')
  })

  it('keeps digits', () => {
    expect(slugify('Chapter 12')).toBe('chapter-12')
  })
})

describe('slugsFor', () => {
  it('numbers repeats after the first, GitHub-style', () => {
    expect(slugsFor(['Notes', 'Notes', 'Notes'])).toEqual([
      'notes',
      'notes-1',
      'notes-2',
    ])
  })

  it('counts repeats independently per heading text', () => {
    expect(slugsFor(['A', 'B', 'A', 'B', 'A'])).toEqual([
      'a',
      'b',
      'a-1',
      'b-1',
      'a-2',
    ])
  })

  it('falls back to `section` for a heading with nothing sluggable in it', () => {
    // Emoji and punctuation normalize away entirely. Without the fallback these
    // would all be '' and the copied link would point at '#'.
    expect(slugsFor(['🎉', '???', '🎉'])).toEqual([
      'section',
      'section-1',
      'section-2',
    ])
  })

  it('treats a de-duplicated slug as its own name, not a collision', () => {
    // 'Notes 1' normalizes to 'notes-1', which is also what a second 'Notes'
    // would produce. Documented as a known collision rather than papered over:
    // the alternative is diverging from the convention every renderer uses.
    expect(slugsFor(['Notes', 'Notes', 'Notes 1'])).toEqual([
      'notes',
      'notes-1',
      'notes-1',
    ])
  })
})
