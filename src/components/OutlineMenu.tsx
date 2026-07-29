import { useCallback, useState } from 'react'
import type { OutlineEntry } from '../editor/outline'
import { useDismissable } from '../hooks/useDismissable'

interface OutlineMenuProps {
  outline: OutlineEntry[]
  /** Index of the caret's section, or -1 above the first heading. */
  activeIndex: number
  onJump: (index: number) => void
}

/** Nesting step per heading level, plus the list's own inset. */
const INDENT_PX = 12
const INSET_PX = 8

/**
 * The breadcrumb, doubling as the document outline.
 *
 * Above the first heading there is no current section, so the trigger shows
 * just its marker rather than inventing a name for the preamble — the caret
 * still says it opens something, and `aria-label` carries the meaning.
 */
export function OutlineMenu({
  outline,
  activeIndex,
  onJump,
}: OutlineMenuProps) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const container = useDismissable<HTMLDivElement>(open, close)

  const current = outline[activeIndex]

  return (
    <div className="outline" ref={container}>
      <button
        type="button"
        className="outline__trigger"
        aria-label="Document outline"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={outline.length === 0}
        title={
          outline.length === 0
            ? 'No headings in this document'
            : 'Jump to a section'
        }
        onClick={() => setOpen(value => !value)}
      >
        <span className="outline__marker" aria-hidden="true">
          §
        </span>
        {current ? (
          <span className="outline__label">{current.text}</span>
        ) : null}
        <span className="outline__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="outline__menu" role="menu">
          <ul className="outline__list">
            {outline.map((entry, index) => (
              <li key={`${entry.pos}:${entry.text}`}>
                <button
                  type="button"
                  className="outline__item"
                  role="menuitem"
                  aria-current={index === activeIndex}
                  // Indent from the level rather than six CSS selectors.
                  style={{
                    paddingInlineStart: `${(entry.level - 1) * INDENT_PX + INSET_PX}px`,
                  }}
                  onClick={() => {
                    onJump(index)
                    setOpen(false)
                  }}
                >
                  {entry.text || 'Untitled section'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
