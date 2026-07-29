import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { COMMENT_MARK_NAME, findMarkRanges } from './comment'

export const commentActiveKey = new PluginKey<string | null>('commentActive')

/**
 * Highlights the active thread with decorations rather than mark attributes.
 *
 * Selecting a thread is a pure UI event. Writing it into the mark's attrs would
 * put a transaction on the undo stack, so Cmd-Z would start undoing *clicks*
 * before it undid typing. Decorations change nothing in the document.
 */
export const CommentActive = Extension.create({
  name: 'commentActive',

  addProseMirrorPlugins() {
    return [
      new Plugin<string | null>({
        key: commentActiveKey,

        state: {
          init: () => null,
          apply(tr, value) {
            const next = tr.getMeta(commentActiveKey) as
              | string
              | null
              | undefined
            return next === undefined ? value : next
          },
        },

        props: {
          decorations(state) {
            const activeId = commentActiveKey.getState(state)
            if (!activeId) return DecorationSet.empty

            const type = state.schema.marks[COMMENT_MARK_NAME]
            if (!type) return DecorationSet.empty

            return DecorationSet.create(
              state.doc,
              findMarkRanges(state.doc, type, activeId).map(({ from, to }) =>
                Decoration.inline(from, to, {
                  class: 'comment-anchor--active',
                }),
              ),
            )
          },
        },
      }),
    ]
  },
})

export function setActiveThread(editor: Editor, id: string | null): void {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(commentActiveKey, id))
}

export function getActiveThread(editor: Editor): string | null {
  return commentActiveKey.getState(editor.state) ?? null
}
