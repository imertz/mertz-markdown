import { useEffect, useMemo, useRef, useState } from 'react'
import { useDismissable } from '../../hooks/useDismissable'
import type { SearchScope } from '../../hooks/useSearchPanel'
import { useSearchPanel } from '../../hooks/useSearchPanel'
import { segments } from '../../lib/highlight'
import { relative } from '../../lib/time'
import { buildSnippet } from '../../search/snippet'
import type { PassageDoc } from '../../search/types'
import { CloseIcon } from '../icons'

export interface SearchHit {
  passage: PassageDoc
  /** The query that found it, so the caller can highlight it in the document. */
  term: string
}

interface SearchPanelProps {
  onClose: () => void
  onOpenHit: (hit: SearchHit) => void
  /** Runs pending autosaves before the first query. */
  flushPendingWrites: () => Promise<void>
  /** Changes when vault sync replaces IndexedDB records. */
  storageRevision: number
}

const SCOPES: { value: SearchScope; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'document', label: 'Documents' },
  { value: 'comment', label: 'Comments' },
  { value: 'trash', label: 'Trash' },
]

const KIND_LABEL: Partial<Record<PassageDoc['kind'], string>> = {
  title: 'Title',
  heading: 'Heading',
  codeBlock: 'Code',
  tableRow: 'Table',
  comment: 'Comment',
}

/** What a row shows to the right of its snippet. */
function hintFor(passage: PassageDoc): string {
  const kind = KIND_LABEL[passage.kind]
  if (passage.headingPath && kind) return `${kind} · ${passage.headingPath}`
  return kind ?? passage.headingPath
}

export function SearchPanel({
  onClose,
  onOpenHit,
  flushPendingWrites,
  storageRevision,
}: SearchPanelProps) {
  const panel = useSearchPanel(flushPendingWrites, storageRevision)
  const { query, scope, results, searching } = panel
  const [cursor, setCursor] = useState(0)
  const container = useDismissable<HTMLDivElement>(true, onClose)
  const list = useRef<HTMLDivElement>(null)

  /*
   * Groups are for display; the keyboard walks one flat list across them, so
   * arrow keys cross a document boundary without the user having to think
   * about where one group ends.
   */
  const rows = useMemo(
    () =>
      (results?.groups ?? []).flatMap(group =>
        group.hits.map(hit => ({ group, passage: hit.passage })),
      ),
    [results],
  )

  const active = Math.min(cursor, Math.max(rows.length - 1, 0))

  useEffect(() => {
    setCursor(0)
  }, [query, scope])

  useEffect(() => {
    list.current
      ?.querySelector(`[data-row="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (index: number) => {
    const row = rows[index]
    if (!row) return
    onOpenHit({ passage: row.passage, term: query })
    onClose()
  }

  const move = (delta: 1 | -1) => {
    if (!rows.length) return
    setCursor((active + delta + rows.length) % rows.length)
  }

  const facets = results?.facets
  const countFor = (value: SearchScope): number | null => {
    if (!facets) return null
    if (value === 'document') return facets.documents
    if (value === 'comment') return facets.comments
    if (value === 'trash') return facets.trashed
    return results?.total ?? null
  }

  return (
    <div className="palette-backdrop">
      <div
        className="search-panel"
        ref={container}
        role="dialog"
        aria-modal="true"
        aria-label="Search all documents"
      >
        <header className="search-panel__header">
          <input
            type="text"
            className="search-panel__input"
            value={query}
            placeholder="Search across every document…"
            // Distinct from the dialog's own label, or both match by name.
            aria-label="Search query"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onChange={event => panel.setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                move(1)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                move(-1)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                choose(active)
              }
            }}
          />
          <button
            type="button"
            className="search-panel__close"
            aria-label="Close search"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="search-panel__scopes" role="tablist" aria-label="Filter results">
          {SCOPES.map(option => {
            const count = countFor(option.value)
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                className="search-panel__scope"
                aria-selected={scope === option.value}
                onClick={() => panel.setScope(option.value)}
              >
                {option.label}
                {count === null ? null : (
                  <span className="search-panel__count">{count}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="search-panel__body" ref={list}>
          {!query.trim() ? (
            <p className="search-panel__empty">
              Search the text of every document, its comments and its trash.
            </p>
          ) : searching && !results ? (
            <p className="search-panel__empty">Searching…</p>
          ) : rows.length === 0 ? (
            <p className="search-panel__empty">No matches for “{query.trim()}”</p>
          ) : (
            (results?.groups ?? []).map(group => (
              <section className="search-panel__group" key={group.docId}>
                <h3 className="search-panel__doc">
                  <span className="search-panel__doc-title">{group.title}</span>
                  {group.trashed ? (
                    <span className="search-panel__badge">In trash</span>
                  ) : null}
                  <span className="search-panel__doc-time">
                    {relative(group.updatedAt)}
                  </span>
                </h3>

                <ul className="search-panel__hits">
                  {group.hits.map(hit => {
                    const index = rows.findIndex(
                      row => row.passage.id === hit.passage.id,
                    )
                    const snippet = buildSnippet(hit.passage.text, query)
                    const hint = hintFor(hit.passage)

                    return (
                      <li key={hit.passage.id}>
                        <button
                          type="button"
                          data-row={index}
                          className="search-panel__hit"
                          aria-current={index === active}
                          // mousedown, not click: useDismissable closes on
                          // mousedown outside, and a click would land after
                          // the unmount.
                          onMouseDown={event => {
                            event.preventDefault()
                            choose(index)
                          }}
                          onMouseEnter={() => setCursor(index)}
                        >
                          <span className="search-panel__snippet">
                            {segments(snippet.text, snippet.matched).map((part, i) =>
                              part.on ? (
                                <mark key={i}>{part.text}</mark>
                              ) : (
                                <span key={i}>{part.text}</span>
                              ),
                            )}
                          </span>
                          {hint ? (
                            <span className="search-panel__hint">{hint}</span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
