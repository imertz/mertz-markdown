import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const focusBlockKey = new PluginKey('focusBlock')

/** Class the CSS keys off; everything else in the document dims around it. */
export const FOCUS_BLOCK_CLASS = 'is-focus-block'

/**
 * Marks the top-level block the caret is in, for focus mode.
 *
 * A decoration rather than a node attribute, for the same reason CommentActive
 * uses one: moving the caret is a pure UI event, and writing it into the
 * document would put every cursor move on the undo stack, so Cmd-Z would start
 * undoing *clicks* before it undid typing.
 *
 * The decoration is applied unconditionally, whether or not focus mode is on.
 * It costs one `resolve` per transaction and nothing else, and it keeps the
 * toggle purely a CSS concern — turning focus mode on must not have to rebuild
 * the plugin state or dispatch a transaction into the document.
 */
export const FocusBlock = Extension.create({
  name: 'focusBlock',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: focusBlockKey,

        props: {
          decorations(state) {
            const { $head } = state.selection

            // depth 0 is the doc itself — a selection spanning everything, or
            // a NodeSelection on a top-level node, leaves nothing to single
            // out. Dimming the whole document would be worse than dimming none
            // of it.
            if ($head.depth === 0) return DecorationSet.empty

            // The top-level ancestor, not the immediate parent: inside a list
            // or a table the block that should stay lit is the whole list, not
            // the one item the caret happens to be in.
            const pos = $head.before(1)
            const node = state.doc.nodeAt(pos)
            if (!node) return DecorationSet.empty

            return DecorationSet.create(state.doc, [
              Decoration.node(pos, pos + node.nodeSize, {
                class: FOCUS_BLOCK_CLASS,
              }),
            ])
          },
        },
      }),
    ]
  },
})
