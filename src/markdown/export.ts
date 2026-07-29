import type { Editor, JSONContent } from '@tiptap/core'
import { repairCodeSpans } from './codeSpans'

const isEmptyParagraph = (node: JSONContent | undefined): boolean =>
  node?.type === 'paragraph' && (!node.content || node.content.length === 0)

const CELL_TYPES = new Set(['tableCell', 'tableHeader'])

const SPACE: JSONContent = { type: 'text', text: ' ' }

/**
 * Every inline node under a run of blocks, with the joins between them — and
 * every hard break — reduced to a single space.
 *
 * A pipe table cell is one line. `collapseWhitespace` in the upstream table
 * renderer squashes the runs this leaves behind, so the spaces are separators
 * rather than formatting.
 */
function inlineContentOf(blocks: readonly JSONContent[]): JSONContent[] {
  const inline: JSONContent[] = []

  const walk = (node: JSONContent, top: boolean) => {
    if (node.type === 'hardBreak') {
      inline.push(SPACE)
      return
    }
    // A leaf that carries text (or an inline node we do not recognise) is
    // taken as-is; anything else is a container to descend into.
    if (node.type === 'text' || !node.content) {
      if (!top) inline.push(node)
      return
    }
    for (const child of node.content) walk(child, false)
  }

  for (const [index, block] of blocks.entries()) {
    if (index > 0) inline.push(SPACE)
    walk(block, true)
  }

  return inline
}

/**
 * No `content` key at all when there is nothing to carry: an empty paragraph
 * next to another is what makes the Paragraph extension emit `&nbsp;`, and the
 * flatten below is the one thing that could manufacture the pair.
 */
const asParagraph = (inline: JSONContent[]): JSONContent =>
  inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' }

/**
 * One paragraph per table cell — all a GFM pipe table can hold.
 *
 * The schema enforces this for anything written since the constraint landed
 * (src/editor/extensions/tableCells.ts). Documents stored *before* it can still
 * carry two paragraphs, because `Node.fromJSON` does not check content
 * expressions unless `enableContentCheck` is on, and it is off — so they load
 * without complaint. Left alone, the upstream table renderer joins those blocks
 * with a literal `<br>`, which is raw HTML in a file that guarantees none.
 *
 * NOTE: this deliberately does NOT escape `|` in cell text, though an
 * unescaped pipe does split the cell on re-read. There is no way to fix it
 * from here: `renderTableToMarkdown` has no escaping on the render side at all
 * (`preprocessTablePipes` is import-only), and a `\` placed in the text is
 * itself escaped to `\\` on the way out — so no document-level string
 * serializes as `\|`. See the known limitation in README.md.
 *
 * Recursive because a table nests: blockquotes and list items are `block+`.
 */
function flattenTableCells(node: JSONContent): JSONContent {
  if (!node.content?.length) return node

  if (CELL_TYPES.has(node.type ?? '') && node.content.length > 1) {
    return { ...node, content: [asParagraph(inlineContentOf(node.content))] }
  }

  let changed = false
  const content = node.content.map(child => {
    const next = flattenTableCells(child)
    if (next !== child) changed = true
    return next
  })

  // Same identity when nothing needed doing, which is the common case.
  return changed ? { ...node, content } : node
}

/**
 * Strip artifacts that are correct inside the editor but noise in a `.md` file:
 *
 *  - TrailingNode appends an empty paragraph to any document that doesn't end
 *    in one, so the user can click below the last block.
 *  - The Paragraph extension renders a *run* of empty paragraphs as literal
 *    `&nbsp;` lines (EMPTY_PARAGRAPH_MARKDOWN in @tiptap/extension-paragraph).
 *    Entity references are legal CommonMark, but they are the closest thing to
 *    pollution in the default output path.
 *  - A table cell holding more than one block, which the upstream renderer
 *    would emit as `<br>`-joined HTML.
 */
export function normalizeDocForExport(doc: JSONContent): JSONContent {
  const content = [...(doc.content ?? [])]

  while (content.length > 1 && isEmptyParagraph(content[content.length - 1])) {
    content.pop()
  }

  return flattenTableCells({
    ...doc,
    content: content.filter(
      (node, index) =>
        !(isEmptyParagraph(node) && isEmptyParagraph(content[index - 1])),
    ),
  })
}

/** Tidy whitespace without disturbing CommonMark's two-space hard break. */
function tidy(markdown: string): string {
  return markdown
    .replace(/[ \t]+$/gm, match => (match === '  ' ? match : ''))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*$/, '\n')
}

/**
 * The one place raw serializer output becomes a publishable `.md` string.
 * Both the Editor-backed and the standalone paths funnel through here so they
 * cannot drift apart.
 */
export function finalizeMarkdown(
  raw: string,
  normalizedDoc: JSONContent,
): string {
  return tidy(repairCodeSpans(raw, normalizedDoc))
}

/**
 * Serialize a document to markdown. This is the ONLY way markdown may leave the
 * app — `editor.getMarkdown()` skips the normalizer and the code-span repair
 * above. Enforced by schema-lock.test.ts.
 */
export function serializeDoc(editor: Editor, doc: JSONContent): string {
  if (!editor.markdown) {
    throw new Error('Markdown extension is not registered on this editor')
  }
  const normalized = normalizeDocForExport(doc)
  return finalizeMarkdown(editor.markdown.serialize(normalized), normalized)
}

export function toMarkdown(editor: Editor): string {
  return serializeDoc(editor, editor.getJSON())
}
