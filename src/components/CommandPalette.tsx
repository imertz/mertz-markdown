import { useEffect, useMemo, useRef, useState } from 'react'
import { useDismissable } from '../hooks/useDismissable'
import { fuzzyMatch } from '../lib/fuzzy'
import { segments } from '../lib/highlight'

export interface PaletteAction {
  id: string
  label: string
  /** Right-aligned context — "Document · 2h ago", "Heading 2", "⌘F". */
  hint?: string
  run: () => void
}

interface CommandPaletteProps {
  actions: readonly PaletteAction[]
  onClose: () => void
}

/** Enough to scroll through; past this the query is the better tool. */
const MAX_RESULTS = 40

interface Row {
  action: PaletteAction
  matched: number[]
}

/**
 * Jump anywhere, run anything, from the keyboard.
 *
 * The action list is assembled by the caller, which is what lets documents and
 * the live heading outline sit in the same list as the commands — the palette
 * itself knows nothing about either.
 */
export function CommandPalette({ actions, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const container = useDismissable<HTMLDivElement>(true, onClose)
  const list = useRef<HTMLUListElement>(null)

  const rows = useMemo<Row[]>(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      // Registry order, which groups commands before documents before
      // headings — a browsable list rather than an arbitrary one.
      return actions.slice(0, MAX_RESULTS).map(action => ({
        action,
        matched: [],
      }))
    }

    return actions
      .map(action => {
        const hit = fuzzyMatch(action.label, trimmed)
        return hit ? { action, matched: hit.matched, score: hit.score } : null
      })
      .filter((row): row is Row & { score: number } => row !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
  }, [actions, query])

  // A cursor left pointing past the end of a narrowed list would make Enter do
  // nothing, which reads as the palette being broken.
  const active = Math.min(cursor, Math.max(rows.length - 1, 0))

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (row: Row | undefined) => {
    if (!row) return
    // Run before closing: an action that moves focus itself — opening the find
    // bar, focusing the editor — must get the last word over the caller's own
    // focus restore, and React commits the unmount only after this returns.
    row.action.run()
    onClose()
  }

  const move = (delta: 1 | -1) => {
    if (rows.length === 0) return
    setCursor((active + delta + rows.length) % rows.length)
  }

  return (
    <div className="palette-backdrop">
      <div className="palette" ref={container} role="dialog" aria-modal="true">
        <input
          type="text"
          className="palette__input"
          value={query}
          placeholder="Search documents, headings and commands…"
          aria-label="Command palette"
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={
            rows.length ? `palette-option-${active}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          autoFocus
          onChange={event => {
            setQuery(event.target.value)
            setCursor(0)
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              move(-1)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              choose(rows[active])
            }
          }}
        />

        <ul className="palette__list" id="palette-list" role="listbox" ref={list}>
          {rows.map((row, index) => (
            <li
              key={row.action.id}
              id={`palette-option-${index}`}
              className="palette__item"
              role="option"
              aria-selected={index === active}
              // mousedown, not click: useDismissable closes on mousedown
              // anywhere outside, and a click would arrive after the unmount.
              onMouseDown={event => {
                event.preventDefault()
                choose(row)
              }}
              onMouseEnter={() => setCursor(index)}
            >
              <span className="palette__label">
                {segments(row.action.label, row.matched).map((part, i) =>
                  part.on ? (
                    <mark key={i}>{part.text}</mark>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </span>
              {row.action.hint ? (
                <span className="palette__hint">{row.action.hint}</span>
              ) : null}
            </li>
          ))}

          {rows.length === 0 ? (
            <li className="palette__empty">No matches</li>
          ) : null}
        </ul>
      </div>
    </div>
  )
}
