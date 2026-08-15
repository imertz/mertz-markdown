import { useCallback, useMemo, useState } from 'react'
import { useDismissable } from '../../hooks/useDismissable'
import { foldLabel, normalizeProject } from '../../lib/labels'
import {
  collectProjects,
  collectTags,
  filterDocuments,
  groupByProject,
} from '../../lib/library'
import { relative } from '../../lib/time'
import type { DocumentRecord } from '../../types'
import { ChevronDownIcon } from '../icons'
import { DocumentRow } from './DocumentRow'
import { TagFilterBar } from './TagFilterBar'

interface DocumentListProps {
  documents: DocumentRecord[]
  trashed: DocumentRecord[]
  activeId: string | null
  activeTitle: string
  onSelect: (id: string) => void
  /** A project files the new document straight into it. */
  onCreate: (project?: string | null) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onDestroy: (id: string) => void
  /** An empty name hands the title back to the content. */
  onRename: (id: string, name: string) => void
  onSetProject: (id: string, project: string | null) => void
  onSetTags: (id: string, tags: string[]) => void
  /** `null` unfiles every document in the project. */
  onRenameProject: (from: string, to: string | null) => void
  /** `null` removes the tag from every document carrying it. */
  onRenameTag: (from: string, to: string | null) => void
}

/** Below this the filter box is furniture — every document already fits. */
const FILTER_THRESHOLD = 8

/**
 * Collapse-state key for the unfiled group.
 *
 * Real projects are keyed `project:<folded name>`, so no project — including
 * one actually called "unfiled" — can collide with this and collapse the wrong
 * section.
 */
const UNFILED_KEY = 'unfiled'

export function DocumentList({
  documents,
  trashed,
  activeId,
  activeTitle,
  onSelect,
  onCreate,
  onDelete,
  onRestore,
  onDestroy,
  onRename,
  onSetProject,
  onSetTags,
  onRenameProject,
  onRenameTag,
}: DocumentListProps) {
  const [open, setOpen] = useState(false)
  // Which trashed document is one more click away from being gone for good.
  const [confirming, setConfirming] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // Which project heading is being renamed, and the name so far.
  const [renamingProject, setRenamingProject] = useState<string | null>(null)
  const [projectDraft, setProjectDraft] = useState('')

  const close = useCallback(() => {
    setOpen(false)
    setConfirming(null)
    setQuery('')
    setSelectedTags([])
    setRenamingProject(null)
  }, [])
  const container = useDismissable<HTMLDivElement>(open, close)

  // Derived from every document, not from the filtered set: chips that vanish
  // as you use them cannot be used to widen the filter again.
  const projects = useMemo(() => collectProjects(documents), [documents])
  const tags = useMemo(() => collectTags(documents), [documents])

  const sections = useMemo(
    () => groupByProject(filterDocuments(documents, { query, tags: selectedTags })),
    [documents, query, selectedTags],
  )

  const activeProject =
    documents.find(record => record.id === activeId)?.project ?? null

  const toggleTag = (tag: string) => {
    setSelectedTags(current =>
      current.some(candidate => foldLabel(candidate) === foldLabel(tag))
        ? current.filter(candidate => foldLabel(candidate) !== foldLabel(tag))
        : [...current, tag],
    )
  }

  const toggleSection = (key: string) => {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const commitProjectRename = (from: string) => {
    const next = normalizeProject(projectDraft)
    if (next && foldLabel(next) !== foldLabel(from)) onRenameProject(from, next)
    setRenamingProject(null)
    setProjectDraft('')
  }

  const filtering = query.trim() !== '' || selectedTags.length > 0

  return (
    <div className="doc-picker" ref={container}>
      <button
        type="button"
        className="doc-picker__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(value => !value)}
      >
        {/* The project is shown here and nowhere else while editing — it is the
            one place the answer to "where am I" already belongs. */}
        {activeProject ? (
          <span className="doc-picker__trigger-project">{activeProject} /</span>
        ) : null}
        <span className="doc-picker__title">{activeTitle}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="doc-picker__menu" role="menu">
          <button
            type="button"
            className="doc-picker__new"
            onClick={() => {
              onCreate()
              close()
            }}
          >
            + New document
          </button>

          {documents.length >= FILTER_THRESHOLD ? (
            <input
              type="text"
              className="doc-picker__filter"
              value={query}
              placeholder="Filter documents…"
              aria-label="Filter documents"
              autoComplete="off"
              spellCheck={false}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Escape' || !query) return
                // Clearing the filter first, closing the menu second: the user
                // who typed into this box means the box.
                event.stopPropagation()
                setQuery('')
              }}
            />
          ) : null}

          <TagFilterBar
            tags={tags}
            selected={selectedTags}
            onToggle={toggleTag}
            onClearSelection={() => setSelectedTags([])}
            onRename={onRenameTag}
          />

          {sections.length === 0 ? (
            <p className="doc-picker__empty">No documents match this filter.</p>
          ) : null}

          {sections.map(section => {
            const key = section.project
              ? `project:${foldLabel(section.project)}`
              : UNFILED_KEY
            // A filtered list is a search result: hiding part of it behind a
            // collapsed heading would hide the very thing being looked for.
            const isCollapsed = !filtering && collapsed.has(key)

            return (
              <section className="doc-picker__section" key={key}>
                <h3 className="doc-picker__section-heading">
                  {renamingProject === section.project && section.project ? (
                    <form
                      className="doc-picker__section-form"
                      onSubmit={event => {
                        event.preventDefault()
                        commitProjectRename(section.project as string)
                      }}
                    >
                      <input
                        autoFocus
                        className="doc-picker__section-input"
                        aria-label={`Rename project ${section.project}`}
                        value={projectDraft}
                        onChange={event => setProjectDraft(event.target.value)}
                        onKeyDown={event => {
                          if (event.key !== 'Escape') return
                          event.stopPropagation()
                          setRenamingProject(null)
                          setProjectDraft('')
                        }}
                        onBlur={() =>
                          commitProjectRename(section.project as string)
                        }
                      />
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="doc-picker__section-toggle"
                        aria-expanded={!isCollapsed}
                        disabled={filtering}
                        onClick={() => toggleSection(key)}
                      >
                        {/* One drawn shape rotated, rather than two typed
                            triangles that resolve through different fallback
                            fonts and never sit on the same baseline. */}
                        <ChevronDownIcon className="doc-picker__section-mark" />
                        <span className="doc-picker__section-name">
                          {section.project ?? 'No project'}
                        </span>
                        <span className="doc-picker__section-count">
                          {section.documents.length}
                        </span>
                      </button>

                      {section.project ? (
                        <button
                          type="button"
                          className="doc-picker__section-action"
                          aria-label={`Rename project ${section.project}`}
                          title="Rename project"
                          onClick={() => {
                            setProjectDraft(section.project as string)
                            setRenamingProject(section.project)
                          }}
                        >
                          Rename
                        </button>
                      ) : null}

                      {/* Creating from inside a section is the only way a
                          document arrives already filed, and the only reason
                          `create` takes a project at all. */}
                      <button
                        type="button"
                        className="doc-picker__section-action"
                        aria-label={
                          section.project
                            ? `New document in ${section.project}`
                            : 'New document with no project'
                        }
                        title="New document here"
                        onClick={() => {
                          onCreate(section.project)
                          close()
                        }}
                      >
                        + New
                      </button>
                    </>
                  )}
                </h3>

                {isCollapsed ? null : (
                  <ul className="doc-picker__list">
                    {section.documents.map(record => (
                      <DocumentRow
                        key={record.id}
                        document={record}
                        active={record.id === activeId}
                        projects={projects}
                        onSelect={id => {
                          onSelect(id)
                          close()
                        }}
                        onRename={onRename}
                        onSetProject={onSetProject}
                        onSetTags={onSetTags}
                        onDelete={onDelete}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}

          {trashed.length ? (
            <section className="doc-picker__trash">
              <h3 className="doc-picker__trash-heading">
                <span>Trash ({trashed.length})</span>
                <span className="doc-picker__trash-note">
                  cleared after 30 days
                </span>
              </h3>

              <ul className="doc-picker__list">
                {trashed.map(document_ => (
                  <li key={document_.id} className="doc-picker__item">
                    <span className="doc-picker__trashed">
                      <span className="doc-picker__item-title">
                        {document_.title}
                      </span>
                      <span className="doc-picker__item-time">
                        {document_.deletedAt === null
                          ? ''
                          : relative(document_.deletedAt)}
                      </span>
                    </span>

                    <button
                      type="button"
                      className="doc-picker__trash-action"
                      onClick={() => {
                        onRestore(document_.id)
                        close()
                      }}
                    >
                      Restore
                    </button>

                    {/*
                      Two clicks, no dialog. This is the one action in the app
                      with nothing behind it, and a button that changes what it
                      says is harder to hit by accident than one that does not.
                    */}
                    <button
                      type="button"
                      className="doc-picker__trash-action doc-picker__trash-action--danger"
                      aria-label={
                        confirming === document_.id
                          ? `Confirm deleting ${document_.title} for good`
                          : `Delete ${document_.title} for good`
                      }
                      onClick={() => {
                        if (confirming === document_.id) {
                          onDestroy(document_.id)
                          setConfirming(null)
                        } else {
                          setConfirming(document_.id)
                        }
                      }}
                    >
                      {confirming === document_.id ? 'Sure?' : 'Delete'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
