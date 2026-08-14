import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { COMMENT_MARK_NAME, findMarkRanges } from './comment'

export interface CommentSanitizerOptions {
  /** Thread ids that legitimately belong to the open document. */
  getKnownThreadIds: () => ReadonlySet<string> | null
}

export const COMMENT_SANITIZER_RECHECK = 'commentSanitizer:recheck'

/**
 * Strips comment anchors pasted in from another document.
 *
 * The mark has a `parseHTML` rule so that cut/paste *within* a document keeps
 * its threads (ProseMirror's clipboard round-trips through HTML). The cost is
 * that pasting from a different document carries `data-comment-thread` values
 * with no matching thread record, which would render as highlights pointing at
 * nothing.
 */
export const CommentSanitizer = Extension.create<CommentSanitizerOptions>({
  name: 'commentSanitizer',

  addOptions() {
    return { getKnownThreadIds: () => null }
  },

  addProseMirrorPlugins() {
    const { getKnownThreadIds } = this.options

    return [
      new Plugin({
        key: new PluginKey('commentSanitizer'),

        appendTransaction(transactions, _oldState, newState) {
          if (
            !transactions.some(
              tr => tr.docChanged || tr.getMeta(COMMENT_SANITIZER_RECHECK),
            )
          ) {
            return null
          }

          const type = newState.schema.marks[COMMENT_MARK_NAME]
          if (!type) return null

          const known = getKnownThreadIds()
          // `null` means threads have not loaded yet. An empty set is an
          // authoritative document with no threads, so foreign pasted anchors
          // must still be stripped.
          if (known === null) return null

          const foreign = findMarkRanges(newState.doc, type).filter(
            hit => !known.has(hit.mark.attrs.threadId as string),
          )
          if (!foreign.length) return null

          const tr = newState.tr
          for (const { from, to, mark } of foreign) tr.removeMark(from, to, mark)
          return tr.setMeta('addToHistory', false)
        },
      }),
    ]
  },
})
