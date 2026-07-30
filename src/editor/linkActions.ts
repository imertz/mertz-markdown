import type { Editor } from '@tiptap/core'
import { getMarkRange } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import type { Mark } from '@tiptap/pm/model'

export interface LinkRange {
  from: number
  to: number
  href: string
}

/** The href of the link mark at a document position, or `''` if there is none. */
export function hrefAt(state: EditorState, pos: number): string {
  const type = state.schema.marks.link
  if (!type) return ''
  const mark = state.doc
    .resolve(pos)
    .marks()
    .find((candidate: Mark) => candidate.type === type)
  return typeof mark?.attrs.href === 'string' ? mark.attrs.href : ''
}

/**
 * The link mark's full range and href at a document position, or `null` if the
 * position is not inside one.
 *
 * Shared by the edit shortcut and the hover card, so "what counts as being
 * inside a link" cannot drift between the two entry points.
 */
export function linkRangeAt(state: EditorState, pos: number): LinkRange | null {
  const type = state.schema.marks.link
  if (!type) return null

  const $pos = state.doc.resolve(pos)
  if (!$pos.marks().some((candidate: Mark) => candidate.type === type)) return null

  const range = getMarkRange($pos, type)
  if (!range) return null

  return { from: range.from, to: range.to, href: hrefAt(state, pos) }
}

/** Removes the link mark spanning `range`, growing it if the range is partial. */
export function unlinkRange(editor: Editor, range: { from: number; to: number }): void {
  editor
    .chain()
    .setTextSelection(range)
    .extendMarkRange('link')
    .unsetLink()
    .focus()
    .run()
}
