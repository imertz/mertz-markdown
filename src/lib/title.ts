import type { JSONContent } from '@tiptap/core'

export const UNTITLED = 'Untitled document'

const textOf = (node: JSONContent): string => {
  if (typeof node.text === 'string') return node.text
  return (node.content ?? []).map(textOf).join('')
}

/**
 * Derive a document title from its content — the first heading if there is one,
 * otherwise the first non-empty block. Keeps the document list readable without
 * making the user name anything up front.
 */
export function deriveTitle(doc: JSONContent): string {
  const blocks = doc.content ?? []

  const heading = blocks.find(
    block => block.type === 'heading' && textOf(block).trim() !== '',
  )
  const fallback = blocks.find(block => textOf(block).trim() !== '')

  const source = heading ?? fallback
  if (!source) return UNTITLED

  const text = textOf(source).trim().replace(/\s+/g, ' ')
  if (!text) return UNTITLED

  return text.length > 70 ? `${text.slice(0, 69).trimEnd()}…` : text
}
