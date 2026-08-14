import type { Editor } from '@tiptap/core'
import { useMemo } from 'react'
import { COMMENT_MARK_NAME } from '../editor/extensions/comment'
import { relative } from '../lib/time'
import { orderThreadsForNotes } from '../markdown/threadOrder'
import type { ThreadWithComments } from '../types'

interface CommentEndnotesProps {
  editor: Editor | null
  threads: readonly ThreadWithComments[]
}

const STATUS_LABEL: Record<string, string> = {
  resolved: 'resolved',
  orphaned: 'anchor deleted',
}

/**
 * The comment threads as numbered endnotes, for print only.
 *
 * Its own component rather than a restyled comment rail, because the rail is
 * *unmounted* when the reader collapses it — a CSS-only print treatment would
 * silently print a document with no notes on it for anyone who had the rail
 * hidden, which is the state it is easiest to print from.
 *
 * The numbering comes from orderThreadsForNotes, the same function the
 * annotated HTML export uses, and the in-text superscripts are a CSS counter
 * over the anchors in document order. Both count the same things in the same
 * order, which is what keeps note 3 pointing at superscript 3.
 *
 * Hidden outside @media print by print.css, not by a conditional here: this
 * has to exist in the DOM before the browser takes its print snapshot, and a
 * render triggered from `beforeprint` is not guaranteed to land in time.
 */
export function CommentEndnotes({ editor, threads }: CommentEndnotesProps) {
  const ordered = useMemo(() => {
    // The common document has no comments at all, and this is the whole cost
    // of the feature for it.
    if (!editor || editor.isDestroyed || threads.length === 0) return []
    const { doc } = editor.state
    return orderThreadsForNotes(
      doc,
      editor.schema.marks[COMMENT_MARK_NAME],
      threads,
    ).ordered
  }, [editor, threads])

  if (ordered.length === 0) return null

  return (
    <section className="endnotes" aria-hidden="true">
      <h2 className="endnotes__title">Comments</h2>
      <ol className="endnotes__list">
        {ordered.map(thread => (
          <li className="endnotes__note" key={thread.id}>
            {/* The text the thread was attached to, so a note still makes
                sense when it is read a page away from its anchor. */}
            {thread.selector.exact ? (
              <p className="endnotes__quote">{thread.selector.exact}</p>
            ) : null}

            {STATUS_LABEL[thread.status] ? (
              <p className="endnotes__status">{STATUS_LABEL[thread.status]}</p>
            ) : null}

            {thread.comments.map(comment => (
              <p className="endnotes__comment" key={comment.id}>
                {comment.body}
                <span className="endnotes__time">
                  {' '}
                  — {relative(comment.createdAt)}
                </span>
              </p>
            ))}
          </li>
        ))}
      </ol>
    </section>
  )
}
