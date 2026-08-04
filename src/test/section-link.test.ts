import { describe, expect, it } from 'vitest'
import { isSectionLink, sectionSlugFor } from '../editor/linkActions'

/**
 * The § marks copy `[Title](#slug)`. Everything here is about that link still
 * being a section link by the time it comes back out of a clipboard, which is
 * where the first version of this feature fell over: browsers rewrite relative
 * hrefs to absolute when writing text/html, so the anchor arrived as a link to
 * whatever host the app was served from.
 */
describe('sectionSlugFor', () => {
  it('reads a bare anchor', () => {
    expect(sectionSlugFor('#advisors-of-the-realm')).toBe(
      'advisors-of-the-realm',
    )
  })

  it('reads an absolute link to this same document', () => {
    const href = `${location.origin}${location.pathname}#advisors-of-the-realm`
    expect(sectionSlugFor(href)).toBe('advisors-of-the-realm')
  })

  it('decodes a percent-encoded slug', () => {
    // A Greek heading slugs to Greek, and an href carries that encoded.
    expect(sectionSlugFor('#%CE%BA%CF%8C%CF%83%CE%BC%CE%B5')).toBe('κόσμε')
  })

  it('survives a malformed escape rather than throwing', () => {
    expect(sectionSlugFor('#100%-done')).toBe('100%-done')
  })

  it('rejects an external link, fragment or not', () => {
    expect(sectionSlugFor('https://example.com/page#advisors')).toBeNull()
    expect(sectionSlugFor('https://example.com/')).toBeNull()
  })

  it('rejects a link to another page on this same origin', () => {
    // Same host, different document — the fragment is not ours to resolve.
    expect(sectionSlugFor(`${location.origin}/elsewhere#advisors`)).toBeNull()
  })

  it('rejects an empty or absent fragment', () => {
    expect(sectionSlugFor('#')).toBeNull()
    expect(sectionSlugFor('')).toBeNull()
    expect(sectionSlugFor(`${location.origin}${location.pathname}`)).toBeNull()
  })
})

describe('isSectionLink', () => {
  it('agrees with sectionSlugFor', () => {
    expect(isSectionLink('#a-heading')).toBe(true)
    expect(
      isSectionLink(`${location.origin}${location.pathname}#a-heading`),
    ).toBe(true)
    expect(isSectionLink('https://example.com/#a-heading')).toBe(false)
    expect(isSectionLink('#')).toBe(false)
  })
})
