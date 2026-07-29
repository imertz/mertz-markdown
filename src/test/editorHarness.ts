import { Editor, type JSONContent } from '@tiptap/core'
import { buildExtensions } from '../editor/extensions'

/**
 * A real Editor backed by a detached DOM node.
 *
 * Commands like setComment go through the full ProseMirror transaction
 * pipeline, so tests exercise the same code path the app does rather than
 * poking at JSON by hand.
 */
export function createTestEditor(markdown = ''): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: buildExtensions(),
    content: markdown,
    // Without this the string is parsed as HTML and `**bold**` survives as
    // literal asterisks, which then get backslash-escaped on the way out.
    contentType: 'markdown',
  })
}

export function createTestEditorFromJSON(doc: JSONContent): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: buildExtensions(),
    content: doc,
  })
}

/**
 * Locate `needle` and return its ProseMirror range.
 *
 * Walks per-character rather than per-text-node on purpose: applying a comment
 * mark splits a text node, so by the second call a phrase like "three four"
 * spans two nodes and a naive `node.text.indexOf` would miss it.
 */
export function rangeOfText(
  editor: Editor,
  needle: string,
): { from: number; to: number } {
  let flat = ''
  const positions: number[] = []

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (let i = 0; i < node.text.length; i += 1) {
      flat += node.text[i]
      positions.push(pos + i)
    }
  })

  const index = flat.indexOf(needle)
  if (index === -1) {
    throw new Error(`Text not found in document: ${needle}`)
  }

  const from = positions[index]
  const to = positions[index + needle.length - 1]
  if (from === undefined || to === undefined) {
    throw new Error(`Could not map positions for: ${needle}`)
  }
  return { from, to: to + 1 }
}
