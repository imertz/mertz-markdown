import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { getSearchState } from '../../editor/extensions/search'
import { formatShortcut } from '../../lib/shortcuts'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from '../icons'

interface FindBarProps {
  editor: Editor
  /** Bumped on every ⌘F, so pressing it again re-selects the existing query. */
  focusRequest: number
  onClose: () => void
}

/**
 * Find and replace.
 *
 * Deliberately not wired to `useDismissable`: a find bar that vanished when you
 * clicked into the document could never be used to jump somewhere and start
 * typing, which is most of what it is for. Escape closes it, nothing else does.
 */
export function FindBar({ editor, focusRequest, onClose }: FindBarProps) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const { total, activeIndex } = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const state = getSearchState(instance)
      return { total: state.matches.length, activeIndex: state.activeIndex }
    },
  })

  // Selects rather than merely focuses, so ⌘F over an open bar behaves like
  // every other find box: type straight over the last search.
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusRequest])

  const run = (next: string) => {
    setQuery(next)
    editor.commands.setSearchQuery(next)
  }

  const step = (delta: 1 | -1) => {
    editor.commands.stepSearchMatch(delta)
  }

  const count = !query
    ? ''
    : total === 0
      ? 'No results'
      : `${activeIndex + 1} of ${total.toLocaleString()}`

  return (
    <div className="find-bar-dock">
      <div
        className="find-bar"
        role="search"
        // On the container, not the fields: Escape has to work from the
        // steppers and the replace buttons too, and those are exactly where
        // focus sits after clicking one.
        onKeyDown={event => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          onClose()
        }}
      >
        <div className="find-bar__row">
          <button
            type="button"
            className="find-bar__disclosure"
            aria-expanded={replacing}
            aria-label={replacing ? 'Hide replace' : 'Show replace'}
            title={replacing ? 'Hide replace' : 'Show replace'}
            onClick={() => setReplacing(value => !value)}
          >
            {replacing ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </button>

          <span className="find-bar__glyph" aria-hidden="true">
            <SearchIcon />
          </span>

          <input
            ref={input}
            type="text"
            className="find-bar__input"
            value={query}
            placeholder="Find"
            aria-label="Find in document"
            autoComplete="off"
            spellCheck={false}
            onChange={event => run(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              step(event.shiftKey ? -1 : 1)
            }}
          />

          <span className="find-bar__count" role="status">
            {count}
          </span>

          <button
            type="button"
            aria-label="Previous match"
            title={`Previous match (${formatShortcut('shift+enter')})`}
            disabled={total === 0}
            onClick={() => step(-1)}
          >
            <ChevronUpIcon />
          </button>
          <button
            type="button"
            aria-label="Next match"
            title={`Next match (${formatShortcut('enter')})`}
            disabled={total === 0}
            onClick={() => step(1)}
          >
            <ChevronDownIcon />
          </button>

          <button
            type="button"
            aria-label="Close find"
            title="Close (Esc)"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        {replacing ? (
          <div className="find-bar__row">
            <span className="find-bar__glyph" aria-hidden="true" />

            <input
              type="text"
              className="find-bar__input find-bar__input--grow"
              value={replacement}
              placeholder="Replace with"
              aria-label="Replace with"
              autoComplete="off"
              spellCheck={false}
              onChange={event => setReplacement(event.target.value)}
            />

            <button
              type="button"
              className="find-bar__action"
              disabled={total === 0}
              onClick={() => editor.commands.replaceSearchMatch(replacement)}
            >
              Replace
            </button>
            <button
              type="button"
              className="find-bar__action"
              disabled={total === 0}
              title="Replaces every match as a single undo step"
              onClick={() =>
                editor.commands.replaceAllSearchMatches(replacement)
              }
            >
              All
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
