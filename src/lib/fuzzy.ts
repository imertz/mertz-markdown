export interface FuzzyHit {
  /** Higher is better. Only comparable between candidates for the same query. */
  score: number
  /** Indices in the haystack that the query matched, for highlighting. */
  matched: number[]
}

/** Characters after which the next one starts a new "word". */
const BOUNDARY = /[\s\-_/.:,([]/

/**
 * Subsequence match with positional scoring — the usual command-palette feel:
 * "nd" finds "New document", "sum" finds "Summary".
 *
 * Greedy leftmost, not optimal. Finding the best possible alignment needs
 * backtracking, and for a list of a few hundred short labels nobody can tell
 * the difference — every candidate is scored the same way, so the ordering
 * stays consistent even where the alignment is not ideal.
 *
 * Returns null when the query is not a subsequence at all.
 */
export function fuzzyMatch(haystack: string, query: string): FuzzyHit | null {
  if (!query) return { score: 0, matched: [] }

  const hay = haystack.toLowerCase()
  const needle = query.toLowerCase()

  const matched: number[] = []
  let score = 0
  let cursor = 0
  let previous = -2

  for (const char of needle) {
    const index = hay.indexOf(char, cursor)
    if (index === -1) return null

    if (index === previous + 1) {
      // A run of adjacent characters is what makes a match feel deliberate,
      // so "comm" scores far higher on "Comments" than on "Create my …".
      score += 8
    } else {
      // Capped, or one distant tail character would sink an otherwise good
      // match on a long label.
      score -= Math.min(index - previous - 1, 6)
    }

    if (index === 0) score += 10
    else if (BOUNDARY.test(hay[index - 1])) score += 6

    matched.push(index)
    previous = index
    cursor = index + 1
  }

  // Between two labels that matched equally well, the shorter one used more of
  // itself and is the better answer.
  score -= Math.floor((hay.length - needle.length) / 8)

  return { score, matched }
}
