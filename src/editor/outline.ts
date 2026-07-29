import type { Node as PMNode } from '@tiptap/pm/model'

export interface OutlineEntry {
  /** Position immediately before the heading node. */
  pos: number
  /** Position immediately after it, so callers can ask "is the caret in here?". */
  end: number
  /** 1–6, as the heading node's own attribute reports it. */
  level: number
  text: string
}

/** Caret position that puts the cursor inside the heading's text. */
export const caretFor = (entry: OutlineEntry): number => entry.pos + 1

/**
 * Every heading in the document, in order.
 *
 * Headings are top-level children, so this walks the doc's direct children
 * rather than descending — proportional to the block count, not to the length
 * of the text, which is what makes it cheap enough to run on every debounce
 * tick beside the word count.
 */
export function collectOutline(doc: PMNode): OutlineEntry[] {
  const entries: OutlineEntry[] = []

  doc.forEach((child, offset) => {
    if (child.type.name !== 'heading') return
    entries.push({
      pos: offset,
      end: offset + child.nodeSize,
      level: Number(child.attrs.level) || 1,
      text: child.textContent.trim(),
    })
  })

  return entries
}

/**
 * Index of the section the caret sits in, or -1 above the first heading.
 *
 * A document can open with prose before any heading — that is a real position,
 * not a missing one, so it gets -1 rather than being snapped to entry 0.
 */
export function activeHeadingIndex(
  outline: readonly OutlineEntry[],
  caret: number,
): number {
  let index = -1
  for (let i = 0; i < outline.length; i += 1) {
    if (outline[i].pos >= caret) break
    index = i
  }
  return index
}

/**
 * The heading a previous/next step should land on, or null when there is none.
 *
 * Clamps rather than wrapping, unlike comment navigation: wrapping from the last
 * section back to the first would misreport where you are in the document. The
 * arrows disable at the ends instead, which says the same thing honestly.
 *
 * Stepping back from inside a section lands on that section's own heading
 * first. Pressing `‹` halfway down "Summary" should take you to "Summary", and
 * only a second press should leave it.
 */
export function stepHeading(
  outline: readonly OutlineEntry[],
  caret: number,
  delta: -1 | 1,
): OutlineEntry | null {
  if (outline.length === 0) return null

  const active = activeHeadingIndex(outline, caret)

  if (delta === 1) return outline[active + 1] ?? null
  if (active < 0) return null

  const inHeading = caret >= outline[active].pos && caret <= outline[active].end
  return outline[inHeading ? active - 1 : active] ?? null
}
