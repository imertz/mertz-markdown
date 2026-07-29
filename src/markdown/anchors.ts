import type { Node as PMNode } from '@tiptap/pm/model'
import type { TextQuoteSelector } from '../types'

/** How much surrounding text to keep for disambiguation. */
const CONTEXT_LENGTH = 32

/** Block separator used consistently when flattening the document to text. */
const BLOCK_SEP = '\n'

const flatten = (doc: PMNode, from: number, to: number): string =>
  doc.textBetween(from, to, BLOCK_SEP, BLOCK_SEP)

/**
 * Capture a W3C TextQuoteSelector for a range.
 *
 * Only used as the *fallback* anchor: within a session the ProseMirror mark
 * tracks edits by itself. This earns its keep when a plain `.md` is imported,
 * where the marks cannot have survived, and when showing the original quote on
 * an orphaned thread whose text is gone.
 */
export function buildSelector(
  doc: PMNode,
  from: number,
  to: number,
): TextQuoteSelector {
  const size = doc.content.size
  return {
    exact: flatten(doc, from, to),
    prefix: flatten(doc, Math.max(0, from - CONTEXT_LENGTH), from),
    suffix: flatten(doc, to, Math.min(size, to + CONTEXT_LENGTH)),
  }
}

interface FlatDoc {
  text: string
  /** Document position of each character in `text`. */
  positions: number[]
}

/** Flatten to a searchable string that maps back to document positions. */
function flattenWithPositions(doc: PMNode): FlatDoc {
  let text = ''
  const positions: number[] = []
  let lastEnd: number | null = null

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    // Insert a separator when we cross a block boundary, mirroring
    // textBetween's behaviour so offsets stay comparable.
    if (lastEnd !== null && pos > lastEnd) {
      text += BLOCK_SEP
      positions.push(lastEnd)
    }
    for (let i = 0; i < node.text.length; i += 1) {
      text += node.text[i]
      positions.push(pos + i)
    }
    lastEnd = pos + node.nodeSize
  })

  return { text, positions }
}

const rangeAt = (
  flat: FlatDoc,
  index: number,
  length: number,
): { from: number; to: number } | null => {
  const from = flat.positions[index]
  const to = flat.positions[index + length - 1]
  if (from === undefined || to === undefined) return null
  return { from, to: to + 1 }
}

/**
 * Find where a selector points in the current document.
 *
 * Tries the fully-contextualised match first, then falls back to the bare quote
 * — preferring the occurrence whose surroundings look most like the recorded
 * context, so a repeated phrase re-anchors to the right instance. Returns
 * `null` when the text is gone, which the caller treats as orphaned.
 */
export function resolveSelector(
  doc: PMNode,
  selector: TextQuoteSelector,
): { from: number; to: number } | null {
  if (!selector.exact) return null

  const flat = flattenWithPositions(doc)

  // 1. Exact match including both sides of context.
  const contextual = selector.prefix + selector.exact + selector.suffix
  const contextualIndex = flat.text.indexOf(contextual)
  if (contextualIndex !== -1) {
    return rangeAt(
      flat,
      contextualIndex + selector.prefix.length,
      selector.exact.length,
    )
  }

  // 2. Bare quote, scored by how much of the recorded context still matches.
  let best: { index: number; score: number } | null = null
  let searchFrom = 0

  for (;;) {
    const index = flat.text.indexOf(selector.exact, searchFrom)
    if (index === -1) break

    const before = flat.text.slice(Math.max(0, index - CONTEXT_LENGTH), index)
    const after = flat.text.slice(
      index + selector.exact.length,
      index + selector.exact.length + CONTEXT_LENGTH,
    )
    const score =
      commonSuffixLength(before, selector.prefix) +
      commonPrefixLength(after, selector.suffix)

    if (!best || score > best.score) best = { index, score }
    searchFrom = index + 1
  }

  if (!best) return null
  return rangeAt(flat, best.index, selector.exact.length)
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[i] === b[i]) i += 1
  return i
}

function commonSuffixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1
  return i
}
