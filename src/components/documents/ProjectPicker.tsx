import { useRef, useState } from 'react'
import { normalizeProject } from '../../lib/labels'
import type { LabelCount } from '../../lib/library'

interface ProjectPickerProps {
  title: string
  /** The document's current project, or `null` when unfiled. */
  current: string | null
  /** Every project already in use, so filing is mostly picking, not typing. */
  projects: readonly LabelCount[]
  onChoose: (project: string | null) => void
  onClose: () => void
}

/**
 * Where a document is filed.
 *
 * A list of what exists plus a field for what does not, because projects are
 * derived from the documents carrying them — there is nowhere to create one
 * ahead of time, so the first document filed under a name is what brings the
 * project into existence.
 */
export function ProjectPicker({
  title,
  current,
  projects,
  onChoose,
  onClose,
}: ProjectPickerProps) {
  const [typing, setTyping] = useState(projects.length === 0)
  const [draft, setDraft] = useState('')
  const abandoned = useRef(false)

  const choose = (project: string | null) => {
    onChoose(project)
    onClose()
  }

  return (
    <div className="doc-picker__projects" role="group" aria-label={`Project for ${title}`}>
      <ul className="doc-picker__project-list">
        {projects.map(project => (
          <li key={project.name}>
            <button
              type="button"
              className="doc-picker__project-option"
              aria-current={current === project.name}
              onMouseDown={event => {
                event.preventDefault()
                choose(project.name)
              }}
            >
              {project.name}
            </button>
          </li>
        ))}

        {current === null ? null : (
          <li>
            <button
              type="button"
              className="doc-picker__project-option doc-picker__project-option--none"
              onMouseDown={event => {
                event.preventDefault()
                choose(null)
              }}
            >
              No project
            </button>
          </li>
        )}
      </ul>

      {typing ? (
        <form
          className="doc-picker__project-form"
          onSubmit={event => {
            event.preventDefault()
            if (abandoned.current) return
            // An empty name is not a project called "" — it is the user
            // deciding not to file after all.
            const project = normalizeProject(draft)
            if (project) choose(project)
            else onClose()
          }}
        >
          <input
            autoFocus
            className="doc-picker__project-input"
            aria-label={`New project for ${title}`}
            placeholder="New project name"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Escape') return
              // As in the rename field: the picker's Escape handler would close
              // the whole menu, and backing out of this field is smaller.
              event.stopPropagation()
              abandoned.current = true
              onClose()
            }}
            onBlur={onClose}
          />
        </form>
      ) : (
        <button
          type="button"
          className="doc-picker__project-new"
          onMouseDown={event => {
            event.preventDefault()
            setTyping(true)
          }}
        >
          + New project…
        </button>
      )}
    </div>
  )
}
