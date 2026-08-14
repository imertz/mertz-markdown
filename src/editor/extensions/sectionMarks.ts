import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { slugsFor } from '../../markdown/slug'

export const sectionMarksKey = new PluginKey('sectionMarks')

/** How long the mark reports back after a successful copy. */
const CONFIRM_MS = 1200

/**
 * A § in the margin beside every heading. Click it and the markdown link to
 * that section lands on the clipboard.
 *
 * Widget decorations, not a CSS ::before: this has to be clickable and
 * focusable, and a pseudo-element is neither. Widgets are view-level — they
 * are not document content, never reach the serializer, and cannot appear in
 * the exported `.md`. markdown-roundtrip covers that.
 *
 * The anchors are computed across the whole document rather than per heading,
 * because de-duplicating repeats is what makes them stable — see slugsFor.
 */
export const SectionMarks = Extension.create({
  name: 'sectionMarks',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: sectionMarksKey,

        props: {
          /*
           * Put same-document anchors back to being anchors.
           *
           * Browsers resolve relative hrefs against the page when they write
           * text/html to the clipboard, so the `<a href="#slug">` the § copies
           * arrives as `href="http://localhost:5173/#slug"`. Pasted unchanged
           * that is an absolute link to wherever the app happened to be
           * running, which the hover card would offer to open in a new tab and
           * — much worse — the exporter would write into the `.md` as
           * `[Title](http://localhost:5173/#slug)`. A document is supposed to
           * outlive the machine it was written on.
           *
           * Scoped to this exact origin and path, so a genuine link to another
           * page that happens to carry a fragment is left alone.
           */
          transformPastedHTML(html) {
            const base = (location.origin + location.pathname).replace(
              /[.*+?^${}()|[\]\\]/g,
              '\\$&',
            )
            return html.replace(
              new RegExp(`href="${base}(#[^"]*)"`, 'g'),
              'href="$1"',
            )
          },

          decorations(state) {
            const headings: { pos: number; text: string }[] = []
            state.doc.forEach((child, offset) => {
              if (child.type.name !== 'heading') return
              headings.push({ pos: offset, text: child.textContent.trim() })
            })
            if (headings.length === 0) return DecorationSet.empty

            const slugs = slugsFor(headings.map(heading => heading.text))

            return DecorationSet.create(
              state.doc,
              headings.map((heading, index) =>
                Decoration.widget(
                  heading.pos + 1,
                  view => build(view, heading.text, slugs[index]),
                  {
                    // Keeps the caret out of it: without this, clicking just
                    // left of a heading can put the selection *inside* the
                    // widget's side of the position.
                    side: -1,
                    ignoreSelection: true,
                    // Nothing about the mark is derived from the document
                    // beyond what is already in the closure, so ProseMirror is
                    // free to reuse the node across redraws.
                    key: `section-mark-${slugs[index]}`,
                  },
                ),
              ),
            )
          },
        },
      }),
    ]
  },
})

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"]/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch,
  )

/**
 * Put the link on the clipboard in BOTH flavours.
 *
 * text/plain carries the markdown, which is what you want when the paste lands
 * in a `.md` file, a terminal, or anywhere else that has no rich text.
 *
 * text/html carries a real anchor, and that is what makes pasting back into
 * this editor produce a working link instead of the literal characters
 * `[Title](#slug)`. ProseMirror prefers text/html when both are present, and
 * the link mark's own parseHTML picks the anchor up. Without it the app is the
 * one place the link it just copied does not work — the editor has no markdown
 * paste conversion, so the plain flavour arrives as text and stays text.
 *
 * The async API rejects when the document is not focused, which is reachable
 * here: the mousedown handler suppresses the focus change that would otherwise
 * come with the click. Rather than report a failure the user cannot act on,
 * fall back to a `copy` event, which can carry both flavours too — then hand
 * focus back to the editor, since selecting the scratch field takes it and
 * losing the caret to a copy would be worse than the problem being solved.
 */
function copyLink(
  view: EditorView,
  markdown: string,
  html: string,
): Promise<void> {
  const legacy = () =>
    new Promise<void>((resolve, reject) => {
      const field = document.createElement('textarea')
      field.value = markdown
      field.setAttribute('readonly', '')
      field.style.position = 'fixed'
      field.style.top = '0'
      field.style.opacity = '0'
      document.body.append(field)
      field.select()

      const onCopy = (event: ClipboardEvent) => {
        event.preventDefault()
        event.clipboardData?.setData('text/plain', markdown)
        event.clipboardData?.setData('text/html', html)
      }
      document.addEventListener('copy', onCopy, { once: true })

      const ok = document.execCommand('copy')
      document.removeEventListener('copy', onCopy)
      field.remove()
      view.focus()

      if (ok) resolve()
      else reject(new Error('copy refused'))
    })

  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return legacy()
  }

  return navigator.clipboard
    .write([
      new ClipboardItem({
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ])
    .catch(legacy)
}

function build(
  view: EditorView,
  text: string,
  slug: string,
): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'section-mark'
  // The glyph is drawn by CSS, not set here: the three states (§, copied,
  // failed) swap it through one pseudo-element, so the button's own box never
  // changes size — and `left` is measured against that box.
  button.title = `Copy a link to “${text}”`
  button.setAttribute('aria-label', `Copy a link to ${text}`)

  // contentEditable=false is what stops ProseMirror treating the button as text
  // to be edited, and stops a click inside it collapsing the selection there.
  button.contentEditable = 'false'

  button.addEventListener('mousedown', event => {
    // The editor would otherwise take the selection on mousedown, before the
    // click ever lands, and the caret would jump to the heading on every copy.
    event.preventDefault()
  })

  button.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()

    void copyLink(
      view,
      `[${text}](#${slug})`,
      `<a href="#${escapeHtml(slug)}">${escapeHtml(text)}</a>`,
    )
      .then(() => {
        // Report back on the element itself rather than through a toast: the
        // pointer is already here, and a copy this small does not deserve a
        // notification across the screen.
        button.dataset.copied = 'true'
        setTimeout(() => delete button.dataset.copied, CONFIRM_MS)
      })
      .catch(() => {
        // Clipboard access can be denied outright. Say so where the click was.
        button.dataset.failed = 'true'
        setTimeout(() => delete button.dataset.failed, CONFIRM_MS)
      })
  })

  return button
}
