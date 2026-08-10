import type { Editor } from '@tiptap/core'
import type { Theme } from '../hooks/useTheme'
import type { CommandMeta } from './catalog'

/** The overlays that take over the keyboard while they are up. */
export type OverlayId =
  | 'palette'
  | 'search'
  | 'history'
  | 'cheatsheet'
  | 'crop'
  | 'extensions'
  | 'extension-document'

/**
 * Everything a command needs to decide whether it applies right now.
 *
 * A plain object rather than a set of live lookups, so `when` is a pure
 * predicate that the palette and the cheat sheet can evaluate outside a
 * keypress — which is the entire reason either of them can show only the
 * commands that would actually do something.
 */
export interface CommandContext {
  editor: Editor | null
  /** The selection covers text — gates commenting on it. */
  hasSelection: boolean
  /** The caret is inside a table — gates the whole table group. */
  inTable: boolean
  overlay: OverlayId | null
  documentCount: number
  activeDocumentId: string | null
  railHidden: boolean
  theme: Theme
}

export interface Command extends CommandMeta {
  /** A catalog key, or a catalog key with a suffix for expanded entries. */
  id: string
  when?: (context: CommandContext) => boolean
  run: () => void
}

/** Whether this command applies in this context. */
export function isLive(command: Command, context: CommandContext): boolean {
  return !command.when || command.when(context)
}
