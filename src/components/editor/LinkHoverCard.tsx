import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LinkRange } from '../../editor/linkActions'
import {
  isSectionLink,
  linkRangeAt,
  scrollToSection,
  unlinkRange,
} from '../../editor/linkActions'
import { ExternalLinkIcon, PencilIcon, TrashIcon } from '../icons'

interface LinkHoverCardProps {
  editor: Editor
  /** True while the edit popover is open — only one link surface at a time. */
  suppressed: boolean
  onEdit: (target: LinkRange) => void
}

/** How long the pointer may spend crossing the gap to the card before it hides. */
const HIDE_DELAY_MS = 200
/** Keeps a card near the right edge from opening off-screen. */
const CARD_WIDTH = 320

function closestAnchor(node: Node | null | undefined): HTMLAnchorElement | null {
  if (!node) return null
  const el = node instanceof Element ? node : node.parentElement
  return el?.closest('a') ?? null
}

/**
 * A document position that resolves *inside* the anchor's marked run, not on
 * its edge.
 *
 * The link mark is `inclusive: false` (it turns off when `autolink` does, and
 * this app leaves autolink off) — so the position right at the start of a
 * link is a mark boundary, and resolving it returns the *preceding* run's
 * marks instead. One step in is unambiguous regardless of length.
 */
function positionInsideAnchor(view: Editor['view'], anchor: HTMLAnchorElement): number {
  const start = view.posAtDOM(anchor, 0)
  const length = anchor.textContent?.length ?? 0
  return start + Math.min(1, length)
}

/**
 * A quiet floating bar under an existing link — its URL, plus Edit / Open /
 * Remove — shown on hover, or when the caret merely rests inside one.
 *
 * Links deliberately do not open on click while editing (see LinkPopover), so
 * without this the only way to even see where a link points was to invoke the
 * edit popover and read its input.
 */
export function LinkHoverCard({ editor, suppressed, onEdit }: LinkHoverCardProps) {
  const [target, setTarget] = useState<LinkRange | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const card = useRef<HTMLDivElement>(null)

  const cancelHide = useCallback(() => {
    if (hideTimer.current === null) return
    clearTimeout(hideTimer.current)
    hideTimer.current = null
  }, [])

  const hide = useCallback(() => {
    cancelHide()
    setTarget(null)
    setPosition(null)
  }, [cancelHide])

  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimer.current = setTimeout(hide, HIDE_DELAY_MS)
  }, [cancelHide, hide])

  const show = useCallback(
    (anchor: HTMLElement, pos: number) => {
      const found = linkRangeAt(editor.state, pos)
      if (!found) return
      cancelHide()
      const box = anchor.getBoundingClientRect()
      setTarget(found)
      setPosition({
        top: box.bottom + 6,
        left: Math.max(12, Math.min(box.left, window.innerWidth - CARD_WIDTH - 12)),
      })
    },
    [editor, cancelHide],
  )

  // Mouse hover over any rendered link.
  useEffect(() => {
    const dom = editor.view.dom

    const onMouseOver = (event: MouseEvent) => {
      const anchor = closestAnchor(event.target as Node | null)
      if (anchor && dom.contains(anchor)) {
        show(anchor, positionInsideAnchor(editor.view, anchor))
      }
    }

    const onMouseOut = (event: MouseEvent) => {
      if (!closestAnchor(event.target as Node | null)) return
      const goingTo = event.relatedTarget as Node | null
      // Crossing from the link into the card itself must not hide it.
      if (goingTo && card.current?.contains(goingTo)) return
      scheduleHide()
    }

    dom.addEventListener('mouseover', onMouseOver)
    dom.addEventListener('mouseout', onMouseOut)
    return () => {
      dom.removeEventListener('mouseover', onMouseOver)
      dom.removeEventListener('mouseout', onMouseOut)
    }
  }, [editor, show, scheduleHide])

  // A bare caret resting inside a link, with nothing selected — the case a
  // click into a link produces, since links do not open on click.
  useEffect(() => {
    const onSelectionUpdate = () => {
      const { empty, from } = editor.state.selection
      if (!empty) {
        hide()
        return
      }
      const anchor = closestAnchor(editor.view.domAtPos(from).node)
      if (!anchor) {
        hide()
        return
      }
      show(anchor, from)
    }

    editor.on('selectionUpdate', onSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', onSelectionUpdate)
    }
  }, [editor, show, hide])

  // A scrolled-away anchor would leave the card pointing at empty space; it
  // does not track the anchor's new position because, unlike LinkPopover, it
  // never holds focus and so cannot rely on focus to keep the page still.
  useEffect(() => {
    const scroller = editor.view.dom.closest('.workspace')
    if (!scroller) return
    scroller.addEventListener('scroll', hide, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', hide)
    }
  }, [editor, hide])

  useEffect(() => {
    if (suppressed) hide()
  }, [suppressed, hide])

  useEffect(() => cancelHide, [cancelHide])

  if (!target || !position || suppressed) return null

  return (
    <div
      className="link-hover-card"
      ref={card}
      role="dialog"
      aria-label="Link preview"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      onMouseEnter={cancelHide}
      onMouseLeave={scheduleHide}
    >
      <span className="link-hover-card__href" title={target.href}>
        {target.href}
      </span>

      <button
        type="button"
        className="link-hover-card__action"
        aria-label="Edit link"
        title="Edit link"
        onClick={() => {
          onEdit(target)
          hide()
        }}
      >
        <PencilIcon />
      </button>

      {/*
        A section link points inside this document, so opening a tab is the one
        thing it must not do — that would reload the app at a fragment nothing
        resolves. It scrolls instead.
      */}
      {isSectionLink(target.href) ? (
        <button
          type="button"
          className="link-hover-card__action link-hover-card__action--section"
          aria-label="Go to this section"
          title="Go to this section"
          onClick={() => {
            scrollToSection(editor, target.href)
            hide()
          }}
        >
          §
        </button>
      ) : (
        <button
          type="button"
          className="link-hover-card__action"
          aria-label="Open link in a new tab"
          title="Open in a new tab"
          onClick={() =>
            window.open(target.href, '_blank', 'noopener,noreferrer')
          }
        >
          <ExternalLinkIcon />
        </button>
      )}

      <button
        type="button"
        className="link-hover-card__action"
        aria-label="Remove link"
        title="Remove link"
        onClick={() => {
          unlinkRange(editor, target)
          hide()
        }}
      >
        <TrashIcon />
      </button>
    </div>
  )
}
