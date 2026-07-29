import type { Editor } from '@tiptap/core'
import type { ThreadWithComments } from '../types'
import { resolveSelector } from './anchors'

export interface ReanchorResult {
  /** Threads whose quoted text was found and re-marked. */
  reanchored: string[]
  /** Threads whose quoted text is no longer present. */
  orphaned: string[]
}

/**
 * Re-attach threads to a document whose content came from a plain `.md` file.
 *
 * This is the case the TextQuoteSelector exists for. Within a session comment
 * positions ride along on ProseMirror marks, but markdown cannot carry them —
 * that is the whole point of keeping the file spec-clean — so after an import
 * the anchors have to be re-found by content.
 *
 * Applied in one chain so the whole re-anchoring is a single undo step.
 */
export function reanchorThreads(
  editor: Editor,
  threads: ThreadWithComments[],
): ReanchorResult {
  const result: ReanchorResult = { reanchored: [], orphaned: [] }
  if (!threads.length) return result

  const chain = editor.chain()
  let applied = false

  for (const thread of threads) {
    const range = resolveSelector(editor.state.doc, thread.selector)
    if (!range) {
      result.orphaned.push(thread.id)
      continue
    }

    chain.setTextSelection(range).setComment(thread.id)
    result.reanchored.push(thread.id)
    applied = true
  }

  if (applied) chain.run()
  return result
}

const MARKDOWN_EXTENSION = /\.(md|markdown|mdown|mkd)$/i

/** Strip a trailing `.md` / `.markdown` and tidy the stem into a title. */
export function titleFromFilename(filename: string): string {
  return (
    filename
      .replace(MARKDOWN_EXTENSION, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Imported document'
  )
}

export const MARKDOWN_MIME = 'text/markdown'
export const MARKDOWN_ACCEPT = '.md,.markdown,.mdown,.mkd,text/markdown'

/**
 * Whether a dropped file is one we can open.
 *
 * The extension is checked first because the MIME type is unreliable: plenty
 * of systems report `.md` as `text/plain` or as nothing at all.
 */
export function isMarkdownFile(file: File): boolean {
  return MARKDOWN_EXTENSION.test(file.name) || file.type === MARKDOWN_MIME
}

/** Trigger a download of `markdown` as a `.md` file. */
export function downloadMarkdown(filename: string, markdown: string): void {
  const safeName = filename.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 100)
  const blob = new Blob([markdown], { type: `${MARKDOWN_MIME};charset=utf-8` })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = safeName.endsWith('.md') ? safeName : `${safeName}.md`
  document.body.append(link)
  link.click()
  link.remove()

  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 10_000)
}
