import { Extension, InputRule } from '@tiptap/core'

/** `[ ] ` / `[x] ` typed at the start of a list item. */
const TASK_MARKER = /^\[([ xX]?)\]\s$/

/**
 * Makes the canonical GFM task syntax work when typed.
 *
 * TaskItem ships an input rule that wraps a *paragraph* into a task list, but
 * typing `- ` first creates a bullet list, and the rule then never fires — so
 * `- [ ] thing`, which is exactly how people write a GFM checkbox, produced a
 * bullet containing the literal text `[ ]`.
 *
 * This rule covers that case only: a bullet list item whose content starts with
 * a task marker becomes a task item.
 */
export const TaskListShortcut = Extension.create({
  name: 'taskListShortcut',

  addInputRules() {
    return [
      new InputRule({
        find: TASK_MARKER,
        handler: ({ state, range, match, chain }) => {
          const { $from } = state.selection

          // depth -1 is the enclosing list item, -2 the list itself.
          if ($from.node(-1)?.type.name !== 'listItem') return
          if ($from.node(-2)?.type.name !== 'bulletList') return

          const checked = (match[1] ?? '').toLowerCase() === 'x'

          chain()
            .deleteRange(range)
            .toggleList('taskList', 'taskItem')
            .updateAttributes('taskItem', { checked })
            .run()
        },
      }),
    ]
  },
})
