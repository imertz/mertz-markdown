import { Extension } from '@tiptap/core'
import { TableCell, TableHeader } from '@tiptap/extension-table'
import type { ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { isInTable } from '@tiptap/pm/tables'

const HARD_BREAK = 'hardBreak'

/**
 * One paragraph per cell, because that is all a GFM pipe table can hold.
 *
 * Upstream ships `block+`. Anything beyond one block is flattened by
 * `renderTableToMarkdown` into a single line whose joins become literal `<br>`
 * tags — raw HTML in a file this app guarantees has none. Constraining the
 * schema means the editor cannot show you something the `.md` cannot keep,
 * rather than quietly losing the difference at save time.
 *
 * Safe for import: `table.parseMarkdown` only ever builds exactly one
 * paragraph per cell. The node NAMES are unchanged, so `markdown/config.ts`
 * and `schema-lock.test.ts` need no entry — `getExtensionField` walks
 * `.parent`, and the parent still declares no `renderMarkdown`, which is what
 * keeps these in `PARENT_RENDERED_NODES`.
 */
export const SingleParagraphTableCell = TableCell.extend({
  content: 'paragraph',
})

export const SingleParagraphTableHeader = TableHeader.extend({
  content: 'paragraph',
})

/** Is any ancestor of `$pos` a table cell? */
function insideCell($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role = $pos.node(depth).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') return true
  }
  return false
}

/**
 * Keeps a cell to a single line.
 *
 * Two layers, because neither covers the other. The keymap handles typing:
 * `content: 'paragraph'` already makes `splitBlock` fail, but the base Enter
 * chain then falls through to `liftEmptyBlock`, and "roughly nothing happens"
 * is not a specification. `Shift-Enter` matters more — a hard break is inline,
 * so the schema does not stop it, and the serializer turns it into `<br>`.
 *
 * The plugin handles everything the keymap cannot see: paste, drop and
 * `setContent`. Same shape as CommentSanitizer — `appendTransaction` with
 * `addToHistory: false`, so cleaning up is never a thing you can undo into.
 */
export const TableCellGuard = Extension.create({
  name: 'tableCellGuard',

  // TipTap's own Keymap extension owns the base Enter chain and sits at the
  // default 100, with ties resolved by list order. Being explicit here means
  // this does not depend on where the resolver happens to place it.
  priority: 1000,

  addKeyboardShortcuts() {
    const swallow = () => isInTable(this.editor.state)
    return {
      Enter: swallow,
      'Shift-Enter': swallow,
      'Mod-Enter': swallow,
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tableCellGuard'),

        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some(transaction => transaction.docChanged)) {
            return null
          }

          const breaks: number[] = []
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== HARD_BREAK) return
            if (insideCell(newState.doc.resolve(pos))) breaks.push(pos)
          })
          if (!breaks.length) return null

          const tr = newState.tr
          for (const pos of breaks) {
            // A space is the closest a pipe cell can get, and it is the same
            // size as the node it replaces — so the positions collected above
            // stay valid without mapping.
            tr.replaceWith(pos, pos + 1, newState.schema.text(' '))
          }
          return tr.setMeta('addToHistory', false)
        },
      }),
    ]
  },
})
