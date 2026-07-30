import type { JSONContent } from '@tiptap/core'

/**
 * Flattening a document the way `src/markdown/anchors.ts` does.
 *
 * This has to agree with `flattenWithPositions` character for character, or the
 * anchors built here resolve to `null` and clicking a search hit silently opens
 * the document without moving the caret. That function walks ProseMirror
 * positions; this one walks the same tree as plain JSON, because indexing runs
 * over every document at boot and only the open one has an editor.
 */

/** Identical to `BLOCK_SEP` in `src/markdown/anchors.ts`. */
export const BLOCK_SEP = '\n'

/**
 * The rule that is easy to get wrong: a separator goes between two pieces of
 * text whenever anything at all sits between them — not just a block boundary.
 *
 * `flattenWithPositions` inserts one when the next text node does not start
 * exactly where the previous one ended, and it returns *before* updating that
 * bookkeeping for non-text nodes. So an inline image or a hardBreak counts,
 * and `hello ![](img) world` flattens to `"hello \n world"`, never
 * `"hello  world"`. Concatenating text runs would produce anchors that never
 * resolve.
 *
 * Expressed over JSON, that reduces to: text is adjacent only to text that is
 * its immediate sibling. Any other node visited in between breaks the run.
 */
export function flattenSubtree(node: JSONContent): string {
  let text = ''
  let needsSeparator = false

  const visit = (current: JSONContent): void => {
    if (current.type === 'text') {
      if (!current.text) return
      // No leading separator: `text` is still empty until the first real run.
      if (text && needsSeparator) text += BLOCK_SEP
      text += current.text
      needsSeparator = false
      return
    }

    needsSeparator = true
    for (const child of current.content ?? []) visit(child)
  }

  visit(node)
  return text
}
