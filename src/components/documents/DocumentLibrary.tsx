import { Fragment, useMemo, useState } from 'react'
import { foldLabel, normalizeProject } from '../../lib/labels'
import type { RecencyBucket } from '../../lib/library'
import {
  bucketByRecency,
  collectProjects,
  collectTags,
  filterDocuments,
  groupByProject,
  isBlankDraft,
} from '../../lib/library'
import type { TimeScale } from '../../lib/time'
import { relative } from '../../lib/time'
import type { DocumentRecord } from '../../types'
import { ChevronDownIcon } from '../icons'
import { DocumentRow } from './DocumentRow'
import { TagFilterBar } from './TagFilterBar'

interface DocumentLibraryProps {
  documents: DocumentRecord[]
  trashed: DocumentRecord[]
  activeId: string | null
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
  /**
   * Called after anything that opens a document. The sidebar itself stays put;
   * only the drawer on a narrow screen uses this to get out of the way.
   */
  onOpened?: () => void
}

/** Below this the filter box is furniture — every document already fits. */
const FILTER_THRESHOLD = 8

/**
 * Below this a group reads as one list and dating it would be ceremony. Set to
 * the filter box's threshold on purpose: the same count is what makes a group
 * too long to take in at a glance, whichever tool is answering it.
 */
const BUCKET_THRESHOLD = 8

/**
 * One blank draft is the document you just made. Two or more are clutter, and
 * only then is a count worth more than the rows.
 */
const FOLD_THRESHOLD = 2

/**
 * What each dated heading leaves for the row underneath it to say.
 *
 * Under TODAY the heading has already said the day, so the row says the hour —
 * nine rows reading "20m ago" are a column of noise, and the same nine reading
 * 09:14, 11:02, 14:30 are a morning's work. Under EARLIER the heading has said
 * almost nothing, so the row says the date and earns its width back.
 */
const SCALES: Record<RecencyBucket['key'], TimeScale> = {
  today: 'clock',
  yesterday: 'clock',
  week: 'weekday',
  earlier: 'date',
}

/**
 * Collapse-state key for the unfiled group.
 *
 * Real projects are keyed `project:<folded name>`, so no project — including
 * one actually called "unfiled" — can collide with this and collapse the wrong
 * section.
 */
const UNFILED_KEY = 'unfiled'

/**
 * Everything in the library: what exists, how it is filed, and what can be done
 * to it without opening it.
 *
 * Only the content. It knows nothing about being a docked column or a slide-over
 * drawer — `LibrarySidebar` owns that, which is what lets one list serve both.
 */
export function DocumentLibrary({
  documents,
  trashed,
  activeId,
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
  onOpened,
}: DocumentLibraryProps) {
  // Which trashed document is one more click away from being gone for good.
  const [confirming, setConfirming] = useState<string | null>(null)
  // Shut by default. The trash is somewhere you go on purpose, and a panel
  // that opens holding what you threw away is answering a question nobody
  // asked.
  const [trashOpen, setTrashOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // Which sections have had their blank drafts unfolded. Keyed the same way as
  // `collapsed`, and empty by default: the fold exists to be left alone.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  // Which project heading is being renamed, and the name so far.
  const [renamingProject, setRenamingProject] = useState<string | null>(null)
  const [projectDraft, setProjectDraft] = useState('')

  // Derived from every document, not from the filtered set: chips that vanish
  // as you use them cannot be used to widen the filter again.
  const projects = useMemo(() => collectProjects(documents), [documents])
  const tags = useMemo(() => collectTags(documents), [documents])

  const sections = useMemo(
    () => groupByProject(filterDocuments(documents, { query, tags: selectedTags })),
    [documents, query, selectedTags],
  )

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

  const toggleDrafts = (key: string) => {
    setRevealed(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /*
   * The row, once. Three lists render it — the dated buckets, the unbucketed
   * fallback and the unfolded drafts — and a row that reads differently in one
   * of them would be a different row.
   */
  const rows = (records: readonly DocumentRecord[], scale?: TimeScale) =>
    records.map(record => (
      <DocumentRow
        key={record.id}
        document={record}
        active={record.id === activeId}
        scale={scale}
        projects={projects}
        onSelect={id => {
          onSelect(id)
          onOpened?.()
        }}
        onRename={onRename}
        onSetProject={onSetProject}
        onSetTags={onSetTags}
        onDelete={onDelete}
      />
    ))

  const commitProjectRename = (from: string) => {
    const next = normalizeProject(projectDraft)
    if (next && foldLabel(next) !== foldLabel(from)) onRenameProject(from, next)
    setRenamingProject(null)
    setProjectDraft('')
  }

  const filtering = query.trim() !== '' || selectedTags.length > 0

  const filterable = documents.length >= FILTER_THRESHOLD

  return (
    <>
      {/*
        The two standing tools, out of the scroll. Both used to ride at the top
        of the list, which meant that the moment the library was long enough to
        need filtering, filtering was the first thing to scroll away.
      */}
      <div
        className={
          filterable ? 'library__tools library__tools--split' : 'library__tools'
        }
      >
        {filterable ? (
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
              // Clearing the filter, not closing the sidebar: the user who
              // typed into this box means the box.
              event.stopPropagation()
              setQuery('')
            }}
          />
        ) : null}

        {/*
          Labelled rather than read off its text, because the text is the part
          that gives way: beside a filter box it shortens to "+ New" and the
          name of the thing it makes should not shorten with it.
        */}
        <button
          type="button"
          className="doc-picker__new"
          aria-label="New document"
          onClick={() => {
            onCreate()
            onOpened?.()
          }}
        >
          {filterable ? '+ New' : '+ New document'}
        </button>
      </div>

      <div className="library__body">
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
          // collapsed heading would hide the very thing being looked for. Same
          // reasoning stands the fold and the buckets down below — a result set
          // is ranked by match, so dating it would be describing the wrong order.
          const isCollapsed = !filtering && collapsed.has(key)

          /*
           * The open document is never folded away, blank or not. It is the one
           * row whose state the user can see the effect of, and a library that
           * hides the document you are looking at is answering the wrong question.
           */
          const blank = filtering
            ? []
            : section.documents.filter(
                record => record.id !== activeId && isBlankDraft(record),
              )
          const folded = blank.length >= FOLD_THRESHOLD ? blank : []
          const listed = folded.length
            ? section.documents.filter(record => !folded.includes(record))
            : section.documents

          // A partition of one is not a partition: a group where everything was
          // touched today gets its rows, not a heading saying so.
          const dated =
            !filtering && listed.length > BUCKET_THRESHOLD
              ? bucketByRecency(listed)
              : []
          const buckets = dated.length > 1 ? dated : null

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
                      onBlur={() => commitProjectRename(section.project as string)}
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

                    {/* Creating from inside a section is the only way a document
                        arrives already filed, and the only reason `create` takes
                        a project at all. */}
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
                        onOpened?.()
                      }}
                    >
                      + New
                    </button>
                  </>
                )}
              </h3>

              {isCollapsed ? null : (
                <>
                  {buckets ? (
                    buckets.map(bucket => (
                      <Fragment key={bucket.key}>
                        <h4 className="doc-picker__bucket">{bucket.label}</h4>
                        <ul className="doc-picker__list">
                          {rows(bucket.documents, SCALES[bucket.key])}
                        </ul>
                      </Fragment>
                    ))
                  ) : listed.length ? (
                    <ul className="doc-picker__list">{rows(listed)}</ul>
                  ) : (
                    // A section that is nothing but blank drafts folds away
                    // whole; an empty list here would leave its rule behind.
                    null
                  )}

                  {/*
                    Not hidden — counted. These rows are identical to each other
                    by construction, so the count says everything the list would
                    have, in one line instead of six, and one click still opens
                    it if what you left in one of them was a title you never
                    typed.
                  */}
                  {folded.length ? (
                    <>
                      <button
                        type="button"
                        className="doc-picker__drafts"
                        aria-expanded={revealed.has(key)}
                        onClick={() => toggleDrafts(key)}
                      >
                        <ChevronDownIcon className="doc-picker__section-mark" />
                        {folded.length} empty drafts
                      </button>

                      {revealed.has(key) ? (
                        <ul className="doc-picker__list">{rows(folded)}</ul>
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
            </section>
          )
        })}

      </div>

      {/*
        The trash, pinned rather than listed.
        It used to be the last section of the same scroll, which put the one
        thing nobody is looking for at the end of everything they are — and on
        a full panel it was cut in half by the bottom edge. As a footer it is a
        line until asked, opens downward into the space it is already sitting
        in, and never moves.
      */}
      {trashed.length ? (
        <section className="library__trash">
          <button
            type="button"
            className="library__trash-bar"
            aria-expanded={trashOpen}
            onClick={() => setTrashOpen(current => !current)}
          >
            <ChevronDownIcon className="doc-picker__section-mark" />
            <span>Trash ({trashed.length})</span>
            <span className="doc-picker__trash-note">cleared after 30 days</span>
          </button>

          <ul
            className="doc-picker__list library__trash-list"
            hidden={!trashOpen}
          >
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
                    onOpened?.()
                  }}
                >
                  Restore
                </button>

                {/*
                  Two clicks, no dialog. This is the one action in the app with
                  nothing behind it, and a button that changes what it says is
                  harder to hit by accident than one that does not.
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
    </>
  )
}
