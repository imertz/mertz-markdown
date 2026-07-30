/** A run of text, and whether the query hit it. */
export interface HighlightPart {
  text: string
  on: boolean
}

/**
 * Split text into the runs a query hit and the runs it did not.
 *
 * Shared by the command palette and the search panel so `<mark>` rendering
 * cannot drift between them. Both feed it a `matched: number[]` of character
 * indices — `fuzzyMatch` produces one from subsequence matching, `buildSnippet`
 * from token matching — which is the only thing this needs to agree on.
 */
export function segments(
  text: string,
  matched: readonly number[],
): HighlightPart[] {
  const hit = new Set(matched)
  const parts: HighlightPart[] = []

  for (let i = 0; i < text.length; i += 1) {
    const on = hit.has(i)
    const last = parts.at(-1)
    if (last && last.on === on) last.text += text[i]
    else parts.push({ text: text[i], on })
  }

  return parts
}
