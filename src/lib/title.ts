import type { JSONContent } from '@tiptap/core'

export const APP_NAME = "Yiannis Mertzanis' Markdown"
export const UNTITLED = 'Untitled document'

/** Build the browser tab title for the currently open document. */
export function pageTitle(documentTitle: string): string {
  const title = documentTitle.trim()
  return !title || title === UNTITLED ? APP_NAME : `${title} | ${APP_NAME}`
}

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
  const meaningfulBlocks = blocks.filter(block => textOf(block).trim() !== '')

  // A slash command is transient editor UI. It remains ordinary text until a
  // command is chosen, but it must not rename a new document while the menu is
  // open (or while the user dismisses it without choosing anything).
  if (
    meaningfulBlocks.length === 1 &&
    textOf(meaningfulBlocks[0]!).trim().startsWith('/')
  ) {
    return UNTITLED
  }

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
