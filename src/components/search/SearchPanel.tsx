import { useEffect, useMemo, useRef, useState } from 'react'
import { useDismissable } from '../../hooks/useDismissable'
import type { SearchScope } from '../../hooks/useSearchPanel'
import { useSearchPanel } from '../../hooks/useSearchPanel'
import { segments } from '../../lib/highlight'
import { foldLabel } from '../../lib/labels'
import { collectProjects, collectTags } from '../../lib/library'
import { relative } from '../../lib/time'
import { buildSnippet } from '../../search/snippet'
import type { PassageDoc } from '../../search/types'
import type { DocumentRecord } from '../../types'
import { CloseIcon, FolderIcon, TagIcon } from '../icons'

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
  /** Live documents, so the panel can say how much "every document" is. */
  corpusCount: number
  /** Live documents to derive available projects and tags for filtering. */
  documents?: readonly DocumentRecord[]
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

/** Past this a document buries every other match; RESULT_LIMIT is 60 total. */
const HITS_PER_DOC = 3
/** Tuned to the one-line row's ~60-char budget: the default radius (90) would
 *  centre the match past the point where the row clips it. */
const SNIPPET_RADIUS = 30

/**
 * What a row shows to the right of its snippet: the deepest heading the
 * passage sits under, unless that heading is the group header restated —
 * `deriveTitle` makes the document title *the first heading*, so without this
 * check most rows' hint opened with the exact text already shown above them.
 */
function hintFor(passage: PassageDoc, docTitle: string): string {
  const kind = KIND_LABEL[passage.kind]
  const deepest = passage.headingPath.split(' › ').pop() ?? ''
  const stem = docTitle.replace(/…$/, '')
  const heading = deepest && !deepest.startsWith(stem) ? deepest : ''

  if (heading && kind) return `${kind} · ${heading}`
  return kind ?? heading
}

type Row = { kind: 'hit'; passage: PassageDoc } | { kind: 'more'; docId: string }

export function SearchPanel({
  onClose,
  onOpenHit,
  flushPendingWrites,
  storageRevision,
  corpusCount,
  documents = [],
}: SearchPanelProps) {
  const panel = useSearchPanel(flushPendingWrites, storageRevision)
  const {
    query,
    scope,
    results,
    searching,
    effectiveProject,
    effectiveTags,
    cleanTerm,
  } = panel
  const [cursor, setCursor] = useState(0)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const container = useDismissable<HTMLDivElement>(true, onClose)
  const list = useRef<HTMLDivElement>(null)

  const projects = useMemo(() => collectProjects(documents), [documents])
  const tags = useMemo(() => collectTags(documents), [documents])

  const hasActiveFilters =
    effectiveProject !== undefined || effectiveTags.length > 0

  /*
   * Groups are for display; the keyboard walks one flat list across them, so
   * arrow keys cross a document boundary without the user having to think
   * about where one group ends. Built once here — not per-row during render —
   * because a document's hits are capped at HITS_PER_DOC until expanded, and
   * `rows` has to reflect exactly what is on screen for the index math to
   * line up with `data-row`.
   */
  const { sections, rows } = useMemo(() => {
    const rows: Row[] = []
    const sections = (results?.groups ?? []).map(group => {
      const open = expanded.has(group.docId)
      const shown = open ? group.hits : group.hits.slice(0, HITS_PER_DOC)

      const items = shown.map(hit => {
        const index = rows.length
        rows.push({ kind: 'hit', passage: hit.passage })
        return {
          index,
          passage: hit.passage,
          snippet: buildSnippet(hit.passage.text, cleanTerm || query, SNIPPET_RADIUS),
          hint: hintFor(hit.passage, group.title),
        }
      })

      const hidden = group.hits.length - shown.length
      const more = hidden > 0 ? rows.length : -1
      if (hidden > 0) rows.push({ kind: 'more', docId: group.docId })

      return { group, items, hidden, more }
    })
    return { sections, rows }
  }, [results, cleanTerm, query, expanded])

  const active = Math.min(cursor, Math.max(rows.length - 1, 0))

  useEffect(() => {
    setCursor(0)
    setExpanded(new Set())
  }, [query, scope, effectiveProject, effectiveTags])

  useEffect(() => {
    list.current
      ?.querySelector(`[data-row="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (index: number) => {
    const row = rows[index]
    if (!row) return
    if (row.kind === 'more') {
      setExpanded(current => new Set(current).add(row.docId))
      return
    }
    onOpenHit({ passage: row.passage, term: cleanTerm || query })
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
        data-keys="overlay"
      >
        <header className="search-panel__header">
          <input
            type="text"
            className="search-panel__input"
            value={query}
            placeholder="Search across every document… (use project:name or #tag)"
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

        <div className="search-panel__controls">
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

          {(projects.length > 0 || tags.length > 0) && (
            <div className="search-panel__filter-bar" aria-label="Filters">
              {projects.length > 0 && (
                <div className="search-panel__filter-group">
                  <label htmlFor="search-project-select" className="search-panel__filter-icon" title="Filter by project">
                    <FolderIcon />
                  </label>
                  <select
                    id="search-project-select"
                    className="search-panel__project-select"
                    aria-label="Filter by project"
                    value={
                      effectiveProject === undefined
                        ? ''
                        : effectiveProject === null
                          ? '__unfiled__'
                          : effectiveProject
                    }
                    onChange={event => {
                      const val = event.target.value
                      if (!val) panel.setProjectFilter(undefined)
                      else if (val === '__unfiled__') panel.setProjectFilter(null)
                      else panel.setProjectFilter(val)
                    }}
                  >
                    <option value="">All projects</option>
                    {projects.map(p => (
                      <option key={p.name} value={p.name}>
                        {p.name} ({p.count})
                      </option>
                    ))}
                    <option value="__unfiled__">Unfiled</option>
                  </select>
                </div>
              )}

              {tags.length > 0 && (
                <div className="search-panel__tag-bar" role="group" aria-label="Filter by tag">
                  <span className="search-panel__filter-icon" title="Filter by tag">
                    <TagIcon />
                  </span>
                  <div className="search-panel__tag-chips">
                    {tags.map(tag => {
                      const isSelected = effectiveTags.some(
                        t => foldLabel(t) === foldLabel(tag.name),
                      )
                      return (
                        <button
                          key={tag.name}
                          type="button"
                          className="search-panel__tag-chip"
                          aria-pressed={isSelected}
                          aria-label={`Filter by #${tag.name} (${tag.count})`}
                          onClick={() => panel.toggleTagFilter(tag.name)}
                        >
                          #{tag.name}
                          <span className="search-panel__tag-count">{tag.count}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {hasActiveFilters && (
            <div className="search-panel__active-filters">
              <span className="search-panel__active-label">Active filters:</span>
              {effectiveProject !== undefined && (
                <span className="search-panel__active-pill">
                  <FolderIcon />
                  <span>{effectiveProject === null ? 'Unfiled' : effectiveProject}</span>
                  <button
                    type="button"
                    className="search-panel__pill-remove"
                    aria-label="Remove project filter"
                    onClick={() => panel.setProjectFilter(undefined)}
                  >
                    <CloseIcon />
                  </button>
                </span>
              )}
              {effectiveTags.map(tag => (
                <span key={tag} className="search-panel__active-pill">
                  <TagIcon />
                  <span>#{tag}</span>
                  <button
                    type="button"
                    className="search-panel__pill-remove"
                    aria-label={`Remove tag filter #${tag}`}
                    onClick={() => panel.toggleTagFilter(tag)}
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="search-panel__clear-btn"
                onClick={panel.clearFilters}
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        <div className="search-panel__body" ref={list}>
          {!query.trim() && !hasActiveFilters ? (
            <p className="search-panel__empty">
              Search the text of every document, its comments and its trash.
              {/*
                How much "every" is. The panel used to describe what it would
                search and then sit blank until you typed — an instrument with
                its needle at rest still tells you what scale it is on.
              */}
              <span className="search-panel__corpus">
                {corpusCount.toLocaleString()}{' '}
                {corpusCount === 1 ? 'document' : 'documents'} indexed
              </span>
            </p>
          ) : searching && !results ? (
            <p className="search-panel__empty">Searching…</p>
          ) : rows.length === 0 ? (
            <p className="search-panel__empty">
              {query.trim()
                ? `No matches for “${query.trim()}”`
                : 'No documents matching the selected filters'}
            </p>
          ) : (
            sections.map(section => (
              <section className="search-panel__group" key={section.group.docId}>
                <h3 className="search-panel__doc">
                  <span className="search-panel__doc-title">{section.group.title}</span>
                  {section.group.project ? (
                    <button
                      type="button"
                      className="search-panel__doc-project"
                      title={`Filter by project: ${section.group.project}`}
                      onClick={() => panel.setProjectFilter(section.group.project)}
                    >
                      <FolderIcon />
                      <span>{section.group.project}</span>
                    </button>
                  ) : null}
                  {section.group.tags?.map(tag => (
                    <button
                      key={tag}
                      type="button"
                      className="search-panel__doc-tag"
                      title={`Filter by tag: #${tag}`}
                      onClick={() => panel.toggleTagFilter(tag)}
                    >
                      #{tag}
                    </button>
                  ))}
                  {section.group.trashed ? (
                    <span className="search-panel__badge">In trash</span>
                  ) : null}
                  <span className="search-panel__doc-meta">
                    {section.group.hits.length === 1
                      ? '1 hit'
                      : `${section.group.hits.length} hits`}
                    {' · '}
                    {relative(section.group.updatedAt)}
                  </span>
                </h3>

                <ul className="search-panel__hits">
                  {section.items.map(item => (
                    <li key={item.passage.id}>
                      <button
                        type="button"
                        data-row={item.index}
                        className="search-panel__hit"
                        aria-current={item.index === active}
                        // mousedown, not click: useDismissable closes on
                        // mousedown outside, and a click would land after
                        // the unmount.
                        onMouseDown={event => {
                          event.preventDefault()
                          choose(item.index)
                        }}
                        onMouseEnter={() => setCursor(item.index)}
                      >
                        <span className="search-panel__snippet">
                          {segments(item.snippet.text, item.snippet.matched).map(
                            (part, i) =>
                              part.on ? (
                                <mark key={i}>{part.text}</mark>
                              ) : (
                                <span key={i}>{part.text}</span>
                              ),
                          )}
                        </span>
                        {item.hint ? (
                          <span className="search-panel__hint">{item.hint}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>

                {section.hidden > 0 ? (
                  <button
                    type="button"
                    data-row={section.more}
                    className="search-panel__more"
                    aria-current={section.more === active}
                    onMouseDown={event => {
                      event.preventDefault()
                      choose(section.more)
                    }}
                    onMouseEnter={() => setCursor(section.more)}
                  >
                    {section.hidden} more in this document
                  </button>
                ) : null}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
