import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import type { RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  COMMENT_MARK_NAME,
  findMarkRanges,
} from '../../editor/extensions/comment'
import { setActiveThread } from '../../editor/extensions/commentActive'
import type { ThreadWithComments } from '../../types'
import { CommentComposer } from './CommentComposer'
import { CommentThreadCard } from './CommentThreadCard'

interface CommentSidebarProps {
  editor: Editor | null
  threads: ThreadWithComments[]
  activeId: string | null
  /** Owned by AppShell so the status bar's orphan chip can scroll to it. */
  orphanSectionRef?: RefObject<HTMLElement | null>
  draftRange: { from: number; to: number } | null
  showResolved: boolean
  onToggleResolved: () => void
  onActivate: (id: string | null) => void
  onSubmitDraft: (body: string) => void
  onCancelDraft: () => void
  onReply: (threadId: string, body: string) => void
  onEdit: (commentId: string, body: string) => void
  onResolve: (threadId: string, resolved: boolean) => void
  onResolveAll: () => void
  onDelete: (threadId: string) => void
  onReanchor: (threadId: string) => void
}

/** Vertical breathing room between stacked cards. */
const CARD_GAP = 12
/**
 * Only used for the frame before a card has been measured; real heights come
 * from offsetHeight. Matches a one-comment card with a single-line quote.
 */
const FALLBACK_CARD_HEIGHT = 148
/**
 * A draft has no comment mark yet — the mark is only applied on submit — so the
 * layout pass cannot find it by thread id the way it finds every other card. It
 * is keyed by this sentinel instead, and positioned from `draftRange` directly.
 * Thread ids are generated, so nothing can collide with it.
 */
const DRAFT_CARD_ID = '__draft__'

export function CommentSidebar({
  editor,
  threads,
  activeId,
  orphanSectionRef,
  draftRange,
  showResolved,
  onToggleResolved,
  onActivate,
  onSubmitDraft,
  onCancelDraft,
  onReply,
  onEdit,
  onResolve,
  onResolveAll,
  onDelete,
  onReanchor,
}: CommentSidebarProps) {
  const rail = useRef<HTMLElement>(null)
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const cardSizes = useRef<ResizeObserver | null>(null)
  const [tops, setTops] = useState<Record<string, number>>({})
  const [revision, setRevision] = useState(0)

  const bump = useCallback(() => setRevision(value => value + 1), [])

  const anchored = threads.filter(thread => thread.status !== 'orphaned')
  const orphaned = threads.filter(thread => thread.status === 'orphaned')

  const visible = anchored.filter(
    thread => showResolved || thread.status !== 'resolved',
  )

  /**
   * Place each card next to its anchor, then push overlapping cards downward in
   * a single pass. Sorting by anchor position first means cards never reorder
   * relative to the text they annotate.
   */
  const layout = useCallback(() => {
    if (!editor || editor.isDestroyed || !rail.current) return

    const type = editor.schema.marks[COMMENT_MARK_NAME]
    if (!type) return

    const railTop = rail.current.getBoundingClientRect().top

    const unplaceable: string[] = []

    // The draft is laid out alongside the real cards, so it lands beside the
    // text it is about and takes part in the same collision pass.
    const anchors: { id: string; pos: number }[] = draftRange
      ? [{ id: DRAFT_CARD_ID, pos: draftRange.from }]
      : []

    for (const thread of visible) {
      const hit = findMarkRanges(editor.state.doc, type, thread.id)[0]
      if (hit) anchors.push({ id: thread.id, pos: hit.from })
      else unplaceable.push(thread.id)
    }

    const desired = anchors
      .map(anchor => {
        try {
          const coords = editor.view.coordsAtPos(anchor.pos)
          return { id: anchor.id, top: coords.top - railTop }
        } catch {
          // coordsAtPos throws if the position is not currently rendered.
          unplaceable.push(anchor.id)
          return null
        }
      })
      .filter((entry): entry is { id: string; top: number } => entry !== null)
      .sort((a, b) => a.top - b.top)

    const next: Record<string, number> = {}
    let cursor = 0

    const place = (id: string, desiredTop: number) => {
      const top = Math.max(desiredTop, cursor)
      next[id] = top
      const height =
        cardRefs.current.get(id)?.offsetHeight ?? FALLBACK_CARD_HEIGHT
      cursor = top + height + CARD_GAP
    }

    for (const entry of desired) place(entry.id, entry.top)

    // A thread we cannot locate still needs a top. Leaving it undefined drops
    // the card to its static position, where every other unplaced card lands
    // too — they stack invisibly on top of one another. Park them below the
    // anchored run instead.
    for (const id of unplaceable) place(id, cursor)

    setTops(previous => {
      const sameLength =
        Object.keys(previous).length === Object.keys(next).length
      if (sameLength && Object.entries(next).every(([k, v]) => previous[k] === v)) {
        return previous
      }
      return next
    })
  }, [editor, visible, draftRange])

  // Runs after paint so measured card heights are real.
  useLayoutEffect(() => {
    layout()
  }, [layout, revision])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    editor.on('update', bump)
    editor.on('selectionUpdate', bump)

    const observer = new ResizeObserver(bump)
    observer.observe(editor.view.dom)
    window.addEventListener('resize', bump)

    return () => {
      editor.off('update', bump)
      editor.off('selectionUpdate', bump)
      observer.disconnect()
      window.removeEventListener('resize', bump)
    }
  }, [editor, bump])

  // Editor -> sidebar: keep the active card in view when the caret moves into
  // a commented range. A newly submitted card renders once without `top`
  // while the layout effect measures its anchor. Scrolling during that frame
  // targets its static fallback position at the top of the rail and drags the
  // entire workspace there, so wait until anchored cards are positioned.
  useEffect(() => {
    if (!activeId) return
    const card = cardRefs.current.get(activeId)
    if (!card) return
    const positioned =
      card.style.top !== '' || card.closest('.orphan-section') !== null
    if (!positioned) return
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId, tops])

  // The draft composer focuses with `preventScroll`, so nothing brings it into
  // view on its own — see CommentComposer. Do it here instead, once the layout
  // pass has given the card a real position. `nearest` means a card that is
  // already on screen (the usual case: it sits beside the selected text) does
  // not move the page at all.
  useEffect(() => {
    if (!draftRange) return
    const card = cardRefs.current.get(DRAFT_CARD_ID)
    if (!card || tops[DRAFT_CARD_ID] === undefined) return
    card.scrollIntoView({ block: 'nearest' })
  }, [draftRange, tops])

  const activate = (threadId: string) => {
    onActivate(threadId)
    if (!editor || editor.isDestroyed) return

    setActiveThread(editor, threadId)
    const type = editor.schema.marks[COMMENT_MARK_NAME]
    if (!type) return
    const hit = findMarkRanges(editor.state.doc, type, threadId)[0]
    if (!hit) return

    editor
      .chain()
      .focus()
      .setTextSelection(hit.from)
      .scrollIntoView()
      .run()
  }

  /*
   * Card heights feed the collision pass, so a card that changes height has to
   * trigger a relayout — opening a reply composer, gaining a comment, a badge
   * appearing. The editor-side observer cannot see any of that: nothing in the
   * document changed, so without this the cards below keep their stale tops and
   * the taller card grows straight through them.
   */
  const observeCard = (element: HTMLElement) => {
    if (typeof ResizeObserver === 'undefined') return
    cardSizes.current ??= new ResizeObserver(bump)
    cardSizes.current.observe(element)
  }

  const registerCard = (id: string) => (element: HTMLElement | null) => {
    const previous = cardRefs.current.get(id)
    if (previous && previous !== element) cardSizes.current?.unobserve(previous)

    if (element) {
      cardRefs.current.set(id, element)
      observeCard(element)
    } else {
      cardRefs.current.delete(id)
    }
  }

  useEffect(
    () => () => {
      cardSizes.current?.disconnect()
      cardSizes.current = null
    },
    [],
  )

  const hasResolved = anchored.some(thread => thread.status === 'resolved')
  const openCount = anchored.filter(thread => thread.status === 'open').length
  const isEmpty = !draftRange && visible.length === 0 && orphaned.length === 0

  /*
   * The prompt is only worth saying when there is something to select. On a
   * blank document it asks for an action that cannot be taken, so the rail
   * stays silent and the ruled margin carries the empty state on its own.
   *
   * Comments are text marks, so text content — not `editor.isEmpty` — is the
   * condition that matters: a document holding only an image has nothing to
   * anchor a thread to either.
   *
   * One boolean through `useEditorState`, which deep-compares its selector
   * result, so this re-renders when the document stops being blank rather than
   * on every keystroke.
   */
  const hasSelectableText =
    useEditorState({
      editor,
      selector: ({ editor: instance }) =>
        instance ? instance.state.doc.textContent.trim().length > 0 : false,
    }) ?? false

  return (
    <aside
      // The empty modifier lets the mobile bottom sheet collapse away entirely
      // rather than eating screen height to say there is nothing to show.
      className={[
        'comment-rail',
        isEmpty ? 'comment-rail--empty' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={rail}
      aria-label="Comments"
    >
      {isEmpty && hasSelectableText ? (
        <p className="comment-rail__empty">Select text to comment</p>
      ) : null}

      {draftRange ? (
        <article
          ref={registerCard(DRAFT_CARD_ID)}
          className="thread-card thread-card--active thread-card--draft"
          style={
            tops[DRAFT_CARD_ID] === undefined
              ? undefined
              : { top: `${tops[DRAFT_CARD_ID]}px` }
          }
        >
          <p className="thread-card__quote">
            {editor?.state.doc.textBetween(
              draftRange.from,
              draftRange.to,
              ' ',
              ' ',
            )}
          </p>
          <CommentComposer
            autoFocus
            preventScroll
            onSubmit={onSubmitDraft}
            onCancel={onCancelDraft}
          />
        </article>
      ) : null}

      {visible.map(thread => (
        <CommentThreadCard
          key={thread.id}
          ref={registerCard(thread.id)}
          thread={thread}
          active={thread.id === activeId}
          top={tops[thread.id]}
          onActivate={() => activate(thread.id)}
          onReply={body => onReply(thread.id, body)}
          onEdit={onEdit}
          onResolve={resolved => onResolve(thread.id, resolved)}
          onDelete={() => onDelete(thread.id)}
          onReanchor={() => onReanchor(thread.id)}
        />
      ))}

      {hasResolved || openCount > 1 ? (
        <div className="comment-rail__footer">
          {hasResolved ? (
            <button
              type="button"
              className="comment-rail__toggle"
              onClick={onToggleResolved}
            >
              {showResolved ? 'Hide' : 'Show'} resolved
            </button>
          ) : null}

          {/* Below two threads there is nothing to save over resolving each. */}
          {openCount > 1 ? (
            <button
              type="button"
              className="comment-rail__toggle"
              onClick={onResolveAll}
            >
              Resolve all ({openCount})
            </button>
          ) : null}
        </div>
      ) : null}

      {orphaned.length ? (
        <section className="orphan-section" ref={orphanSectionRef}>
          <h2 className="orphan-section__heading">
            Orphaned ({orphaned.length})
          </h2>
          {orphaned.map(thread => (
            <CommentThreadCard
              key={thread.id}
              thread={thread}
              active={thread.id === activeId}
              onActivate={() => onActivate(thread.id)}
              onReply={body => onReply(thread.id, body)}
              onEdit={onEdit}
              onResolve={resolved => onResolve(thread.id, resolved)}
              onDelete={() => onDelete(thread.id)}
              onReanchor={() => onReanchor(thread.id)}
            />
          ))}
        </section>
      ) : null}
    </aside>
  )
}
