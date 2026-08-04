import type { Editor } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { COMMENT_MARK_NAME } from '../editor/extensions/comment'
import { withExtension } from '../lib/filename'
import type { ThreadWithComments } from '../types'
import { slugsFor } from './slug'
import { orderThreadsForNotes } from './threadOrder'

/**
 * Export the document *with* its comments, as a self-contained HTML file.
 *
 * A deliberately separate format, not a variant of the markdown export. The
 * `.md` file is guaranteed to carry no trace of the app, and that guarantee is
 * what makes it safe to hand to anyone — so "I want to send someone my notes
 * and the comments on them" needs a different file, not a compromised one.
 *
 * Nothing here goes near `toMarkdown` or `getMarkdown`; the body comes
 * straight from the schema's own DOM serializer, which means the comment
 * mark's existing renderHTML gives us the highlighted anchors for free.
 */

const STYLE = `
:root { color-scheme: light dark; }
body {
  margin: 0 auto; padding: 40px 20px; max-width: 46rem;
  font: 16px/1.6 system-ui, sans-serif; color: #171716; background: #f7f6f4;
}
h1, h2, h3 { line-height: 1.25; }
blockquote { margin: 0; padding-left: 1em; border-left: 3px solid #d5d3cf; color: #6b6a67; }
pre { background: #eeedea; border: 1px solid #dedcd8; border-radius: 3px; padding: 12px 14px; overflow-x: auto; }
code { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; }
pre code { background: none; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #dedcd8; padding: 6px 10px; text-align: start; }
img { display: block; max-width: 100%; height: auto; margin: 1em 0; }
/* A table box shrinks to the picture, so the caption is measured against the
   image rather than against the page. */
.image-figure { display: table; margin: 1em 0; max-width: 100%; }
.image-figure img { margin: 0; }
.image-figure figcaption {
  display: table-caption; caption-side: bottom; padding-top: 0.5em;
  color: #6b6a67; font-size: 0.875em; line-height: 1.35; text-align: center;
}
.comment-anchor { background: rgba(194, 82, 31, 0.14); border-bottom: 1px solid rgba(194, 82, 31, 0.5); }
.annex-ref { text-decoration: none; color: #c2521f; font-weight: 600; padding-inline: 2px; }
.annex { margin-top: 48px; padding-top: 20px; border-top: 1px solid #dedcd8; }
.annex__thread { margin: 20px 0; padding-left: 14px; border-left: 3px solid rgba(194, 82, 31, 0.35); }
.annex__head { margin: 0 0 6px; font-size: 14px; color: #6b6a67; }
.annex__status { font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; opacity: 0.75; }
.annex__comment { margin: 8px 0; }
.annex__comment p { margin: 0; }
.annex__comment time { font-size: 12px; color: #6b6a67; }
@media (prefers-color-scheme: dark) {
  body { color: #f4f3f1; background: #171716; }
  blockquote, .annex__head, .annex__comment time, .image-figure figcaption { color: #a3a29e; }
  pre { background: #212120; border-color: #333331; }
  td, th, .annex { border-color: #333331; }
  .comment-anchor { background: rgba(227, 112, 63, 0.2); border-bottom-color: rgba(227, 112, 63, 0.5); }
  .annex-ref { color: #e3703f; }
  .annex__thread { border-left-color: rgba(227, 112, 63, 0.35); }
}
`.trim()

const STATUS_LABEL = {
  open: 'open',
  resolved: 'resolved',
  orphaned: 'anchor deleted',
} as const

const escape = (value: string): string =>
  value.replace(
    /[&<>"]/g,
    character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ??
      character,
  )

export interface AnnexOptions {
  title: string
  threads: readonly ThreadWithComments[]
  resolveAsset?: (assetId: string) => Promise<Blob | undefined>
}

const blobDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })

const isBlank = (fragment: DocumentFragment): boolean =>
  fragment.childElementCount === 0 && !fragment.textContent?.trim()

/**
 * Markdown's portable image title, drawn as the caption the app shows.
 *
 * A `<figure>` is a block, and a block inside a `<p>` is not something a
 * browser will keep: the parser closes the paragraph in front of it and leaves
 * whatever followed the image stranded outside any block. So the paragraph is
 * split around the picture — the same three pieces the editor draws, and the
 * same ones the .docx gets.
 */
function renderImageCaptions(body: HTMLElement): void {
  for (const image of body.querySelectorAll<HTMLImageElement>('img[title]')) {
    const text = image.getAttribute('title')?.trim() ?? ''
    if (!text) continue

    // Only a paragraph can be broken into blocks. Anywhere else — a heading is
    // the one other place an image can sit — the title stays the tooltip
    // Markdown says it is.
    const paragraph = image.closest('p')
    if (!paragraph) continue

    image.removeAttribute('title')

    /*
     * Ranges rather than plain child moves: an image can sit inside a link or
     * a comment anchor, and extractContents() reproduces that inline markup on
     * whichever side of the split needs it, leaving the image wrapped in its
     * own copy.
     */
    const trailing = document.createRange()
    trailing.setStartAfter(image)
    trailing.setEnd(paragraph, paragraph.childNodes.length)
    const after = trailing.extractContents()

    const leading = document.createRange()
    leading.setStart(paragraph, 0)
    leading.setEndBefore(image)
    const before = leading.extractContents()

    const caption = document.createElement('figcaption')
    caption.textContent = text

    const figure = document.createElement('figure')
    figure.className = 'image-figure'
    figure.append(...paragraph.childNodes, caption)

    // Each half is a shallow clone, so it keeps the paragraph's own attributes
    // — which is where an alignment lives.
    const half = (fragment: DocumentFragment): Element[] => {
      if (isBlank(fragment)) return []
      const block = paragraph.cloneNode(false) as HTMLElement
      block.append(fragment)
      return [block]
    }

    paragraph.replaceWith(...half(before), figure, ...half(after))
  }
}

export async function toAnnotatedHtml(
  editor: Editor,
  { title, threads, resolveAsset }: AnnexOptions,
): Promise<string> {
  const { doc } = editor.state
  const type = editor.schema.marks[COMMENT_MARK_NAME]
  // Document order, so the footnote numbers run down the page. Shared with the
  // printed endnotes so the two never number the same document differently.
  const { ordered, anchored } = orderThreadsForNotes(doc, type, threads)

  const numberOf = new Map(
    ordered.map((thread, index) => [thread.id, index + 1]),
  )

  const body = document.createElement('div')
  body.append(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(doc.content),
  )

  for (const image of body.querySelectorAll<HTMLImageElement>(
    'img[data-local-asset-id]',
  )) {
    const assetId = image.dataset.localAssetId
    const blob = assetId ? await resolveAsset?.(assetId) : undefined
    if (!assetId || !blob) {
      throw new Error('A referenced image is missing from browser storage')
    }
    image.src = await blobDataUrl(blob)
    image.removeAttribute('data-local-asset-id')
  }

  renderImageCaptions(body)
  addHeadingIds(body)

  // A thread's mark is split across every text node it covers; only its first
  // span gets the reference number.
  const numbered = new Set<string>()
  for (const element of body.querySelectorAll('[data-comment-thread]')) {
    const id = element.getAttribute('data-comment-thread')
    const index = id ? numberOf.get(id) : undefined
    if (!id || !index || numbered.has(id)) continue
    numbered.add(id)

    element.id = `anchor-${index}`
    const reference = document.createElement('sup')
    const link = document.createElement('a')
    link.href = `#comment-${index}`
    link.className = 'annex-ref'
    link.textContent = String(index)
    reference.append(link)
    element.after(reference)
  }

  if (ordered.length) body.append(buildAnnex(ordered, numberOf, anchored))

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escape(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    body.innerHTML,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/**
 * Give every heading the anchor the § marks in the editor hand out.
 *
 * Without this the section links copied in the app point at nothing in the
 * app's own export — the one place they most obviously ought to resolve. The
 * ids come from the same slugsFor, so a repeated heading is de-duplicated
 * identically in both, and the whole document is slugged in one pass because
 * that de-duplication depends on the headings that came before.
 */
function addHeadingIds(body: HTMLElement): void {
  const headings = [...body.querySelectorAll('h1, h2, h3, h4, h5, h6')]
  const slugs = slugsFor(headings.map(heading => heading.textContent ?? ''))
  headings.forEach((heading, index) => {
    heading.id = slugs[index]
  })
}

function buildAnnex(
  threads: readonly ThreadWithComments[],
  numberOf: ReadonlyMap<string, number>,
  anchored: ReadonlySet<string>,
): HTMLElement {
  const annex = document.createElement('section')
  annex.className = 'annex'

  const heading = document.createElement('h2')
  heading.textContent = `Comments (${threads.length})`
  annex.append(heading)

  for (const thread of threads) {
    const index = numberOf.get(thread.id)
    if (index === undefined) continue

    const item = document.createElement('article')
    item.className = 'annex__thread'
    item.id = `comment-${index}`

    const head = document.createElement('p')
    head.className = 'annex__head'

    if (anchored.has(thread.id)) {
      const back = document.createElement('a')
      back.href = `#anchor-${index}`
      back.className = 'annex-ref'
      back.textContent = String(index)
      head.append(back, ' ')
    } else {
      // Nothing to jump back to, so the number is plain text.
      head.append(`${index} `)
    }

    if (thread.selector.exact) {
      const quote = document.createElement('q')
      // textContent, not innerHTML: quoted document text is arbitrary and must
      // never be re-parsed as markup on the way into this file.
      quote.textContent = thread.selector.exact
      head.append(quote, ' ')
    }

    const status = document.createElement('span')
    status.className = 'annex__status'
    status.textContent = STATUS_LABEL[thread.status]
    head.append(status)

    item.append(head)

    for (const comment of thread.comments) {
      const block = document.createElement('div')
      block.className = 'annex__comment'

      const text = document.createElement('p')
      text.textContent = comment.body

      const when = document.createElement('time')
      const at = new Date(comment.createdAt)
      when.dateTime = at.toISOString()
      when.textContent = at.toLocaleString()

      block.append(text, when)
      item.append(block)
    }

    annex.append(item)
  }

  return annex
}

/** Trigger a download of `html` as a `.html` file. */
export function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = withExtension(filename, 'html')
  document.body.append(link)
  link.click()
  link.remove()

  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 10_000)
}
