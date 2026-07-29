import { NodeSelection, type EditorState } from '@tiptap/pm/state'
import { CellSelection, isInTable } from '@tiptap/pm/tables'

/**
 * When each of the two bubble bars is on screen.
 *
 * Both predicates live here rather than in the components so they cannot drift
 * into overlapping. They are disjoint by construction: the table bar requires
 * `empty || CellSelection`, the selection bar requires `!empty && !CellSelection`.
 *
 * `hasFocus` is a parameter rather than something read from the view because
 * these REPLACE TipTap's default `shouldShow`, which is what made the focus
 * check. Without it the menu opens over any range something else has selected —
 * every keystroke in the find bar puts the caret on a match, and the menu
 * followed it around the document.
 */
export const isCellSelection = (state: EditorState): boolean =>
  state.selection instanceof CellSelection

export const isImageSelection = (state: EditorState): boolean =>
  state.selection instanceof NodeSelection &&
  state.selection.node.type.name === 'image'

/** Comment and Link: a run of text the user deliberately selected. */
export function shouldShowSelectionBar(
  state: EditorState,
  hasFocus: boolean,
): boolean {
  if (!hasFocus) return false
  // Cells are the table bar's business, and a mark spanning cell boundaries is
  // not something either feature can honour.
  if (isCellSelection(state)) return false

  const { from, to, empty } = state.selection
  if (empty || from === to) return false
  // Nothing to quote when the selection is only node boundaries.
  return state.doc.textBetween(from, to, ' ', ' ').trim().length > 0
}

/**
 * Rows, columns and alignment.
 *
 * Note what falls out of the rule: dragging a text selection *inside* one cell
 * shows the selection bar, not this one. That is the right priority — you
 * selected text, not cells.
 */
export function shouldShowTableBar(
  state: EditorState,
  hasFocus: boolean,
): boolean {
  if (!hasFocus) return false
  if (!isInTable(state)) return false
  return state.selection.empty || isCellSelection(state)
}
