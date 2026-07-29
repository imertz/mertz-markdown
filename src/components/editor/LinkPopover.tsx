import type { Editor } from '@tiptap/core'
import { useEffect, useRef, useState } from 'react'
import { useDismissable } from '../../hooks/useDismissable'
import { normalizeHref } from '../../lib/href'
import { ExternalLinkIcon } from '../icons'

export interface LinkTarget {
  from: number
  to: number
  /** The existing href when editing, `''` when creating. */
  href: string
}

interface LinkPopoverProps {
  editor: Editor
  target: LinkTarget
  onClose: () => void
}

/**
 * Add, edit or remove a link on a range.
 *
 * The range is passed in rather than read from the selection, because focusing
 * this input moves focus out of the editor — the same problem the comment
 * composer has, solved the same way: capture the range at open time and restore
 * it in the chain that applies the mark.
 */
export function LinkPopover({ editor, target, onClose }: LinkPopoverProps) {
  const [href, setHref] = useState(target.href)
  const input = useRef<HTMLInputElement>(null)
  const container = useDismissable<HTMLDivElement>(true, onClose)

  // Measured once: the anchor cannot move while the popover owns the focus.
  const [anchor] = useState(() => {
    try {
      const start = editor.view.coordsAtPos(target.from)
      const end = editor.view.coordsAtPos(target.to)
      return {
        // Below the range, because the bubble menu is above it.
        top: Math.max(start.bottom, end.bottom) + 8,
        // Clamped so a link near the right edge does not open off-screen.
        left: Math.max(12, Math.min(start.left, window.innerWidth - 372)),
      }
    } catch {
      // coordsAtPos throws for a position that is not currently rendered; the
      // stylesheet's own top/left then park it under the header.
      return null
    }
  })

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const normalized = normalizeHref(href)

  const range = { from: target.from, to: target.to }

  const apply = () => {
    if (!normalized) return
    editor
      .chain()
      .setTextSelection(range)
      // Invoked from a caret inside a link, the captured range is the whole
      // link already; from a partial selection inside one, this grows it so
      // editing the href does not split the link in two.
      .extendMarkRange('link')
      .setLink({ href: normalized })
      .focus()
      .run()
    onClose()
  }

  const remove = () => {
    editor
      .chain()
      .setTextSelection(range)
      .extendMarkRange('link')
      .unsetLink()
      .focus()
      .run()
    onClose()
  }

  return (
    <div
      className="link-popover"
      ref={container}
      role="dialog"
      aria-label="Link"
      style={
        anchor ? { left: `${anchor.left}px`, top: `${anchor.top}px` } : undefined
      }
    >
      <input
        ref={input}
        type="url"
        className="link-popover__input"
        value={href}
        placeholder="example.com"
        aria-label="Link address"
        autoComplete="off"
        spellCheck={false}
        onChange={event => setHref(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            apply()
          }
        }}
      />

      {/* Links do not open on click in the editor — this is the only way to
          follow one without leaving the app to guess. */}
      <button
        type="button"
        className="link-popover__open"
        aria-label="Open link in a new tab"
        title="Open in a new tab"
        disabled={!normalized}
        onClick={() => window.open(normalized, '_blank', 'noopener,noreferrer')}
      >
        <ExternalLinkIcon />
      </button>

      <button
        type="button"
        className="btn--primary"
        disabled={!normalized}
        onClick={apply}
      >
        Apply
      </button>

      {target.href ? (
        <button type="button" onClick={remove}>
          Remove
        </button>
      ) : null}
    </div>
  )
}
