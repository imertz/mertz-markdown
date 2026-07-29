import { forwardRef, useState } from 'react'
import { relative } from '../../lib/time'
import type { ThreadWithComments } from '../../types'
import { CheckIcon, PencilIcon } from '../icons'
import { CommentComposer } from './CommentComposer'

interface CommentThreadCardProps {
  thread: ThreadWithComments
  active: boolean
  top?: number
  onActivate: () => void
  onReply: (body: string) => void
  onEdit: (commentId: string, body: string) => void
  onResolve: (resolved: boolean) => void
  onDelete: () => void
  onReanchor: () => void
}

/**
 * Clicking a card jumps the editor caret to the anchored text, which focuses
 * the editor. That must not happen for the card's own controls: it yanks focus
 * out of the reply textarea, so keystrokes land in the document instead of the
 * reply. `focusin` bubbles too, so the focus handler needs the same guard.
 */
const fromCardControl = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  target.closest('button, textarea, input, a, .composer') !== null

export const CommentThreadCard = forwardRef<
  HTMLElement,
  CommentThreadCardProps
>(function CommentThreadCard(
  {
    thread,
    active,
    top,
    onActivate,
    onReply,
    onEdit,
    onResolve,
    onDelete,
    onReanchor,
  },
  ref,
) {
  const [replying, setReplying] = useState(false)
  // Id of the comment being rewritten, if any. Entering edit mode changes the
  // card's height, which the sidebar's per-card ResizeObserver picks up — the
  // editor-side observer cannot, since nothing in the document changed.
  const [editing, setEditing] = useState<string | null>(null)
  const orphaned = thread.status === 'orphaned'
  const resolved = thread.status === 'resolved'

  return (
    <article
      ref={ref}
      className={[
        'thread-card',
        active ? 'thread-card--active' : '',
        resolved ? 'thread-card--resolved' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={top === undefined ? undefined : { top: `${top}px` }}
      tabIndex={0}
      aria-current={active}
      onClick={event => {
        if (!fromCardControl(event.target)) onActivate()
      }}
      onFocus={event => {
        if (!fromCardControl(event.target)) onActivate()
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' && event.target === event.currentTarget) {
          onActivate()
        }
      }}
    >
      {thread.selector.exact ? (
        <blockquote className="thread-card__quote">
          {thread.selector.exact}
        </blockquote>
      ) : null}

      {resolved ? (
        <p className="thread-card__resolved">
          <CheckIcon width={12} height={12} />
          Resolved
        </p>
      ) : null}

      {orphaned ? (
        <p className="thread-card__orphan-note">
          Anchor text was deleted{' '}
          {thread.orphanedAt ? relative(thread.orphanedAt) : ''}
        </p>
      ) : null}

      {/*
       * The author is deliberately not rendered: it is always the constant
       * 'You' (see useThreads) so it carries no information. The record keeps
       * the field for a future identity system.
       */}
      {thread.comments.map(comment =>
        comment.id === editing ? (
          <CommentComposer
            key={comment.id}
            placeholder="Edit comment…"
            submitLabel="Save"
            autoFocus
            initialValue={comment.body}
            onSubmit={body => {
              onEdit(comment.id, body)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div key={comment.id} className="thread-card__comment">
            <div className="thread-card__body">{comment.body}</div>
            <div className="thread-card__meta">
              <time
                className="thread-card__time"
                dateTime={new Date(comment.createdAt).toISOString()}
                // `relative` only recomputes on render, so the label goes
                // stale; the absolute time in the tooltip is always right.
                title={new Date(comment.createdAt).toLocaleString()}
              >
                {relative(comment.createdAt)}
                {comment.updatedAt > comment.createdAt ? ' · edited' : ''}
              </time>
              <button
                type="button"
                className="thread-card__edit"
                aria-label="Edit comment"
                title="Edit"
                onClick={() => setEditing(comment.id)}
              >
                <PencilIcon />
              </button>
            </div>
          </div>
        ),
      )}

      {replying ? (
        <CommentComposer
          placeholder="Reply…"
          submitLabel="Reply"
          autoFocus
          onSubmit={body => {
            onReply(body)
            setReplying(false)
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <div className="thread-card__actions">
          <button type="button" onClick={() => setReplying(true)}>
            Reply
          </button>
          <button type="button" onClick={() => onResolve(!resolved)}>
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
          {orphaned ? (
            <button
              type="button"
              title="Select text in the document first, then click to re-attach"
              onClick={onReanchor}
            >
              Re-anchor
            </button>
          ) : null}
          <button
            type="button"
            className="thread-card__delete"
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      )}
    </article>
  )
})
