import { Extension } from '@tiptap/core'

const INDENT = '  '

/**
 * Keep the browser from treating Tab in the editor as focus navigation.
 *
 * ListItem and TaskItem already own higher-priority Tab shortcuts for nesting
 * and lifting list items. This fallback only runs when those commands decline
 * the key, such as in an ordinary paragraph or at the top level of a list.
 */
export const TabNavigation = Extension.create({
  name: 'tabNavigation',
  priority: 50,

  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.chain().focus().insertContent(INDENT).run(),
      'Shift-Tab': () => {
        const { selection } = this.editor.state
        if (!selection.empty || !selection.$from.parent.isTextblock) return true

        const { $from } = selection
        const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
        if (!before.endsWith(INDENT)) return true

        return this.editor
          .chain()
          .focus()
          .deleteRange({ from: selection.from - INDENT.length, to: selection.from })
          .run()
      },
    }
  },
})
