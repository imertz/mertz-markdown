import { useEditorState } from '@tiptap/react'
import { isInTable } from '@tiptap/pm/tables'
import { useMemo } from 'react'
import type { Shortcut } from '../hooks/useGlobalShortcuts'
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts'
import { isApplePlatform } from '../lib/shortcuts'
import { aliasesFor, type CommandId } from './catalog'
import { parseChord } from './chord'
import { useConflictAssertion } from './conflicts'
import type { Command, CommandContext, OverlayId } from './context'
import { isLive } from './context'
import type { CommandDeps } from './registry'
import { buildCommands, chordOf } from './registry'

export interface CommandsApi {
  /** Everything registered, live or not — the cheat sheet needs both. */
  all: readonly Command[]
  /** The subset that applies right now. */
  live: readonly Command[]
  context: CommandContext
}

/**
 * The one hook AppShell calls to have a working keyboard.
 *
 * Builds the command list, works out what applies, registers the window-level
 * half of it, and shouts in development if two of them collide. Everything
 * else — the palette, the cheat sheet, the peek HUD — reads the returned lists
 * rather than assembling its own.
 */
export function useCommands(
  deps: CommandDeps,
  overlay: OverlayId | null,
): CommandsApi {
  const apple = isApplePlatform()

  /*
   * Two booleans out of the editor, and only these two.
   *
   * `useEditorState` compares with a deep equal, so this re-renders when one of
   * them actually flips rather than on every keystroke. `isInTable` walks the
   * selection's ancestors and stops; `readTableInfo`, which the bubble menu
   * uses, additionally builds a rect and scans the table map twice and would
   * be doing that work on the typing path.
   */
  const editorFlags = useEditorState({
    editor: deps.editor,
    selector: ({ editor }) => {
      if (!editor) return { hasSelection: false, inTable: false }
      const { state } = editor
      return {
        hasSelection: !state.selection.empty,
        inTable: isInTable(state),
      }
    },
  }) ?? { hasSelection: false, inTable: false }

  const context: CommandContext = {
    editor: deps.editor,
    hasSelection: editorFlags.hasSelection,
    inTable: editorFlags.inTable,
    overlay,
    documentCount: deps.documents.documents.length,
    activeDocumentId: deps.documents.activeId,
    railHidden: deps.rail.hidden,
    theme: deps.theme.theme,
  }

  // Unmemoised on purpose — see the note on `CommandDeps`. The handlers close
  // over state, so any memo would need every one of those as a dependency and
  // would miss on every render anyway.
  const all = buildCommands(deps)
  const live = all.filter(command => isLive(command, context))

  /*
   * Only the window's share gets registered.
   *
   * `'editor'` commands are delivered by ProseMirror and would fire twice if
   * they were here too; `'component'` commands belong to whatever has focus.
   * Both still carry a `run`, so the palette and the HUD reach them.
   */
  const bindings = useMemo<Shortcut[]>(() => {
    const table: Shortcut[] = []

    for (const command of live) {
      if (command.dispatch && command.dispatch !== 'window') continue

      const specs = [
        chordOf(command, apple),
        ...(command.id.includes(':')
          ? []
          : aliasesFor(command.id as CommandId, apple)),
      ]

      for (const spec of specs) {
        if (!spec) continue
        table.push({ ...parseChord(spec), run: command.run })
      }
    }

    return table
    // `live` is a fresh array each render; the hook reads its table through a
    // ref, so handing it a new one costs nothing.
  }, [live, apple])

  useGlobalShortcuts(bindings)
  useConflictAssertion(all, context, apple)

  return { all, live, context }
}
