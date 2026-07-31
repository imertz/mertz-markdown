import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'

/** The live `/` query, measured in document positions. */
export interface SlashCommandState {
  /** Position immediately before the slash. */
  from: number
  /** The caret position, immediately after the query. */
  to: number
  query: string
}

type SlashMeta = { type: 'dismiss' }

export const slashCommandKey = new PluginKey<SlashCommandState | null>(
  'slashCommands',
)

/**
 * Find a slash command at the caret without touching the document.
 *
 * Slash commands intentionally start only at the beginning of a text block
 * (after optional spaces). A slash in prose remains an ordinary character —
 * the same safety rule the app uses for bare keyboard shortcuts.
 */
export function slashCommandAt(
  state: EditorState,
): SlashCommandState | null {
  const { selection } = state
  if (!selection.empty) return null

  const { $from } = selection
  const parent = $from.parent
  if (!parent.isTextblock || parent.type.name === 'codeBlock') return null

  const before = parent.textBetween(0, $from.parentOffset, '\n', '\n')
  const match = /^\s*\/([^\n]*)$/.exec(before)
  if (!match) return null

  const query = match[1] ?? ''
  const slashIndex = before.length - query.length - 1
  return {
    from: selection.from - (before.length - slashIndex),
    to: selection.from,
    query,
  }
}

/** Close the menu while leaving the typed slash text in place. */
export function dismissSlashCommand(editor: Editor): void {
  if (editor.isDestroyed || !slashCommandKey.getState(editor.state)) return
  editor.view.dispatch(
    editor.state.tr.setMeta(slashCommandKey, { type: 'dismiss' } satisfies SlashMeta),
  )
}

/** Remove the trigger text and return the insertion point it occupied. */
export function consumeSlashCommand(
  editor: Editor,
  command: SlashCommandState,
): number {
  const position = command.from
  editor
    .chain()
    .focus()
    .deleteRange({ from: command.from, to: command.to })
    .setTextSelection(position)
    .run()
  return position
}

/**
 * Tracks only the transient UI state. The slash and its query are ordinary
 * document text until a menu action consumes them, so Markdown export remains
 * completely unaware of this feature.
 */
export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    return [
      new Plugin<SlashCommandState | null>({
        key: slashCommandKey,
        state: {
          init: () => null,

          apply(tr, value, _oldState, nextState) {
            const meta = tr.getMeta(slashCommandKey) as SlashMeta | undefined
            if (meta?.type === 'dismiss') return null

            // A cursor move away from the query dismisses it. Keeping the
            // previous value on an unrelated transaction avoids rebuilding the
            // menu during every selection update from the comment rail.
            if (tr.selectionSet && !tr.docChanged) {
              return slashCommandAt(nextState)
            }
            if (tr.docChanged) return slashCommandAt(nextState)
            return value
          },
        },
        props: {
          handleKeyDown(view, event) {
            if (event.key !== 'Escape') return false
            if (!slashCommandKey.getState(view.state)) return false

            event.preventDefault()
            view.dispatch(
              view.state.tr.setMeta(
                slashCommandKey,
                { type: 'dismiss' } satisfies SlashMeta,
              ),
            )
            return true
          },
        },
      }),
    ]
  },
})
