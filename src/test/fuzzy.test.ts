import { describe, expect, it } from 'vitest'
import { fuzzyMatch } from '../lib/fuzzy'

const score = (haystack: string, query: string): number => {
  const hit = fuzzyMatch(haystack, query)
  if (!hit) throw new Error(`${query} did not match ${haystack}`)
  return hit.score
}

describe('fuzzyMatch', () => {
  it('matches a subsequence, not just a substring', () => {
    expect(fuzzyMatch('New document', 'nd')).not.toBeNull()
    expect(fuzzyMatch('New document', 'ndx')).toBeNull()
  })

  it('ignores case in both directions', () => {
    expect(fuzzyMatch('Export as Markdown', 'MARK')).not.toBeNull()
    expect(fuzzyMatch('EXPORT', 'export')).not.toBeNull()
  })

  it('reports which characters it matched', () => {
    // C-o-m-m-e-n-t-s: the first 'm' at 2, then 't' at 6.
    expect(fuzzyMatch('Comments', 'cmt')?.matched).toEqual([0, 2, 6])
  })

  it('prefers a contiguous run over scattered letters', () => {
    expect(score('Comments', 'comm')).toBeGreaterThan(
      score('Copy my markdown', 'comm'),
    )
  })

  it('prefers matches that start a word', () => {
    expect(score('Find in document', 'fid')).toBeGreaterThan(
      score('Definitive guide', 'fid'),
    )
  })

  it('prefers the shorter of two equally good labels', () => {
    expect(score('Export', 'export')).toBeGreaterThan(
      score('Export this document as a file', 'export'),
    )
  })

  it('treats an empty query as matching everything', () => {
    expect(fuzzyMatch('anything', '')).toEqual({ score: 0, matched: [] })
  })
})
