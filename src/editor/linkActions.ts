import type { Editor } from '@tiptap/core'
import { getMarkRange } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import type { Mark } from '@tiptap/pm/model'
import { slugsFor } from '../markdown/slug'

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

/**
 * The heading slug a link points at within this document, or null.
 *
 * Accepts the absolute form as well as the bare `#slug`. That is not
 * hypothetical tidiness: a browser rewrites relative hrefs to absolute when it
 * writes text/html to the clipboard, so section links pasted before the paste
 * transform existed are sitting in documents already as
 * `http://host/path#slug`. Recognising them here is what makes those still
 * behave as section links rather than offering to reload the app.
 */
export function sectionSlugFor(href: string): string | null {
  let fragment = ''

  if (href.startsWith('#')) {
    fragment = href.slice(1)
  } else {
    const here = `${location.origin}${location.pathname}#`
    if (href.startsWith(here)) fragment = href.slice(here.length)
  }

  if (!fragment) return null
  try {
    return decodeURIComponent(fragment)
  } catch {
    // A malformed escape is still a usable literal slug.
    return fragment
  }
}

/** True for an in-document anchor — the kind the § marks hand out. */
export function isSectionLink(href: string): boolean {
  return sectionSlugFor(href) !== null
}

/**
 * Jump to the heading a `#anchor` link points at.
 *
 * Returns false when nothing matches, so the caller can leave the link alone
 * rather than silently doing nothing — a section can be renamed or deleted
 * after a link to it was written, and that is a real state, not an error.
 *
 * The slugs are recomputed from the live headings rather than stored anywhere.
 * That is the point of deriving them: a heading is the only source of truth for
 * its own anchor, so a document that has been edited since the link was copied
 * still resolves correctly as long as the heading's text is unchanged.
 */
export function scrollToSection(editor: Editor, href: string): boolean {
  if (editor.isDestroyed) return false

  const slug = sectionSlugFor(href)
  if (!slug) return false

  const root = editor.view.dom
  const headings = [
    ...root.querySelectorAll<HTMLElement>(
      ':scope > :is(h1, h2, h3, h4, h5, h6)',
    ),
  ]
  const index = slugsFor(headings.map(h => h.textContent ?? '')).indexOf(slug)
  if (index < 0) return false

  const heading = headings[index]
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  heading.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })

  // Put the caret in the heading as well as scrolling to it, so the section
  // steppers in the status bar carry on from where the link landed rather than
  // from wherever the caret happened to be.
  const pos = editor.view.posAtDOM(heading, 0)
  if (pos >= 0) editor.commands.setTextSelection(pos + 1)

  return true
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
