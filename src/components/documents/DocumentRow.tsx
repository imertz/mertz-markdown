import { useCallback, useRef, useState } from 'react'
import type { LabelCount } from '../../lib/library'
import type { TimeScale } from '../../lib/time'
import { relative, scaled } from '../../lib/time'
import type { DocumentRecord } from '../../types'
import { FolderIcon, PencilIcon, TagIcon, TrashIcon } from '../icons'
import { ProjectPicker } from './ProjectPicker'
import { TagEditor } from './TagEditor'

interface DocumentRowProps {
  document: DocumentRecord
  active: boolean
  /**
   * How to say when, when a dated heading has already said roughly when.
   * Absent — a list standing on its own — and the row says how long ago.
   */
  scale?: TimeScale
  /** Every project in use, for the filing submenu. */
  projects: readonly LabelCount[]
  onSelect: (id: string) => void
  /** An empty name hands the title back to the content. */
  onRename: (id: string, name: string) => void
  onSetProject: (id: string, project: string | null) => void
  onSetTags: (id: string, tags: string[]) => void
  onDelete: (id: string) => void
}

/** Which of the row's three inline editors is open, if any. */
type Editing = 'rename' | 'tags' | 'project' | null

/**
 * One document in the library: what it is called, when it was last touched, the
 * tags it carries, and the four things you can do to it.
 *
 * Extracted from `DocumentList` when filing arrived. The row now hosts three
 * mutually exclusive inline editors, and keeping that here is what leaves the
 * list itself readable as a list.
 */
export function DocumentRow({
  document: record,
  active,
  scale,
  projects,
  onSelect,
  onRename,
  onSetProject,
  onSetTags,
  onDelete,
}: DocumentRowProps) {
  const [editing, setEditing] = useState<Editing>(null)
  const [draft, setDraft] = useState('')

  // Escape unmounts the field, and an unmounting field must not also save what
  // the user just abandoned.
  const abandoned = useRef(false)
  const stopEditing = useCallback(() => {
    setEditing(null)
    setDraft('')
  }, [])

  const commitRename = useCallback(() => {
    if (abandoned.current) return
    onRename(record.id, draft)
    stopEditing()
  }, [draft, onRename, record.id, stopEditing])

  const tags = record.tags ?? []

  if (editing === 'rename') {
    return (
      <li className="doc-picker__item doc-picker__item--stacked">
        <form
          className="doc-picker__rename-form"
          onSubmit={event => {
            event.preventDefault()
            commitRename()
          }}
        >
          {/* Focused on mount: the field only exists because the user just
              clicked Rename to type in it. */}
          <input
            autoFocus
            className="doc-picker__rename-input"
            aria-label={`Name for ${record.title}`}
            placeholder="Name from the first heading"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Escape') return
              // As a drawer the sidebar listens for Escape on the document,
              // and would close itself over this; cancelling the rename is the
              // smaller thing the user meant. Harmless when docked, where
              // nothing is listening.
              event.stopPropagation()
              abandoned.current = true
              stopEditing()
            }}
            onBlur={commitRename}
          />
        </form>
      </li>
    )
  }

  return (
    <li className="doc-picker__item doc-picker__item--stacked">
      <div className="doc-picker__row">
        <button
          type="button"
          className="doc-picker__select"
          aria-current={active}
          onClick={() => onSelect(record.id)}
        >
          <span className="doc-picker__item-title">{record.title}</span>
          <span className="doc-picker__item-time">
            {scale ? scaled(record.updatedAt, scale) : relative(record.updatedAt)}
          </span>
        </button>

        {/*
          Grouped so they can be lifted out of the row's flow on a pointer
          device: in a 340px column the four of them holding width even while
          invisible was coming straight out of the title. See the stylesheet.
        */}
        <div className="doc-picker__actions">
          {/*
            Rename is seeded with the override rather than the shown title, so
            opening the field on a document that never had a name of its own
            offers an empty box instead of the derived text — submitting that
            text unchanged would silently pin it.
          */}
          <button
            type="button"
            className="doc-picker__rename"
            aria-label={`Rename ${record.title}`}
            title="Rename"
            onClick={() => {
              abandoned.current = false
              setDraft(record.titleOverride ?? '')
              setEditing('rename')
            }}
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            className="doc-picker__file"
            aria-label={`Project for ${record.title}`}
            title={
              record.project ? `Project: ${record.project}` : 'File in a project'
            }
            aria-expanded={editing === 'project'}
            onClick={() => {
              abandoned.current = false
              setEditing(current => (current === 'project' ? null : 'project'))
            }}
          >
            <FolderIcon />
          </button>
          <button
            type="button"
            className="doc-picker__tag-edit"
            aria-label={`Tags for ${record.title}`}
            title="Tags"
            aria-expanded={editing === 'tags'}
            onClick={() => {
              abandoned.current = false
              setEditing(current => (current === 'tags' ? null : 'tags'))
            }}
          >
            <TagIcon />
          </button>
          <button
            type="button"
            className="doc-picker__delete"
            aria-label={`Move ${record.title} to trash`}
            title="Move to trash"
            onClick={() => onDelete(record.id)}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/*
        Read-only while nothing is being edited; the editor below replaces it
        rather than sitting beside it, so a tag never appears twice.

        Set as engraved text rather than as bordered plates. Only the two
        interactive surfaces — the filter row and the editor — draw a housing
        around a tag, because only there is it something you can press. Four
        outlined boxes under every row was furniture standing in for structure.
      */}
      {editing !== 'tags' && tags.length ? (
        <ul className="doc-picker__tags">
          {tags.map(tag => (
            <li key={tag} className="doc-picker__tag">
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      {editing === 'tags' ? (
        <TagEditor
          title={record.title}
          tags={tags}
          onCommit={next => onSetTags(record.id, next)}
          onClose={stopEditing}
        />
      ) : null}

      {editing === 'project' ? (
        <ProjectPicker
          title={record.title}
          current={record.project ?? null}
          projects={projects}
          onChoose={project => onSetProject(record.id, project)}
          onClose={stopEditing}
        />
      ) : null}
    </li>
  )
}
