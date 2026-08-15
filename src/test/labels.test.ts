import { describe, expect, it } from 'vitest'
import {
  hasTag,
  normalizeProject,
  normalizeTag,
  normalizeTags,
  parseTagInput,
  sameProject,
} from '../lib/labels'

/**
 * Normalising labels.
 *
 * The case rule is the one worth pinning: display keeps what was typed,
 * comparison folds. Getting it backwards produces two projects that look
 * identical in the menu and can never be merged from the UI that shows them.
 */

describe('normalizeTag', () => {
  it('strips the leading # users copy off the chips', () => {
    expect(normalizeTag('#draft')).toBe('draft')
    expect(normalizeTag('##draft')).toBe('draft')
  })

  it('trims and collapses internal whitespace', () => {
    expect(normalizeTag('  needs   review  ')).toBe('needs review')
  })

  it('returns null when nothing survives', () => {
    expect(normalizeTag('   ')).toBeNull()
    expect(normalizeTag('#')).toBeNull()
  })

  it('caps a name before it becomes a sentence', () => {
    const long = 'a'.repeat(40)
    expect(normalizeTag(long)).toHaveLength(32)
  })
})

describe('normalizeProject', () => {
  it('leaves a # alone — projects are not tags', () => {
    expect(normalizeProject('#1 priority')).toBe('#1 priority')
  })
})

describe('normalizeTags', () => {
  it('deduplicates case-insensitively, keeping the first spelling', () => {
    // Last-wins would let tagging one document `Draft` silently restyle the
    // chip on every other document that already said `draft`.
    expect(normalizeTags(['draft', 'Draft', 'DRAFT'])).toEqual(['draft'])
  })

  it('drops the empties and sorts', () => {
    expect(normalizeTags(['urgent', '  ', 'draft'])).toEqual(['draft', 'urgent'])
  })
})

describe('parseTagInput', () => {
  it('splits a comma-separated run typed in one go', () => {
    expect(parseTagInput('draft, urgent')).toEqual(['draft', 'urgent'])
  })

  it('splits on whitespace too, so a space is never trapped inside a tag', () => {
    expect(parseTagInput('draft urgent')).toEqual(['draft', 'urgent'])
  })

  it('is empty for input that is only separators', () => {
    expect(parseTagInput('  ,, ')).toEqual([])
  })
})

describe('comparison helpers', () => {
  it('matches tags regardless of case', () => {
    expect(hasTag(['Draft'], 'draft')).toBe(true)
    expect(hasTag(undefined, 'draft')).toBe(false)
  })

  it('treats absent and null as the same unfiled project', () => {
    expect(sameProject(undefined, null)).toBe(true)
    expect(sameProject('Research', 'research')).toBe(true)
    expect(sameProject('Research', null)).toBe(false)
  })
})
