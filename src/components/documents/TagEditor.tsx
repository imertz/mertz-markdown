import { useRef, useState } from 'react'
import { normalizeTags, parseTagInput } from '../../lib/labels'
import { CloseIcon } from '../icons'

interface TagEditorProps {
  /** Named in the field's label, so screen readers say which document. */
  title: string
  /** Seeds the editor. While it is open, the editor owns the list — see below. */
  tags: readonly string[]
  onCommit: (tags: string[]) => void
  onClose: () => void
}

/**
 * The inline tag field.
 *
 * Committing per tag rather than on submit is what makes the comma work: the
 * user types `draft, urgent` in one breath and gets two chips, without the
 * field ever holding a value that means two things at once.
 *
 * That is also why the open editor owns the list rather than reading it back
 * from the prop. Each commit travels to IndexedDB and back before the prop
 * updates, and typing is faster than that round-trip — a second tag committed
 * inside the window would be merged into the list *as it was before the first
 * one*, silently dropping it.
 */
export function TagEditor({ title, tags, onCommit, onClose }: TagEditorProps) {
  const [draft, setDraft] = useState('')
  const [current, setCurrent] = useState(() => normalizeTags(tags))
  // Escape unmounts the field, and an unmounting field must not also save what
  // the user just abandoned. Same guard as the rename field next door.
  const abandoned = useRef(false)

  const apply = (next: string[]) => {
    setCurrent(next)
    onCommit(next)
  }

  const commit = (text: string) => {
    const added = parseTagInput(text)
    if (added.length) apply(normalizeTags([...current, ...added]))
    setDraft('')
  }

  const finish = () => {
    if (abandoned.current) return
    commit(draft)
    onClose()
  }

  return (
    <form
      className="doc-picker__tag-form"
      onSubmit={event => {
        event.preventDefault()
        finish()
      }}
    >
      <ul className="doc-picker__tag-edits">
        {current.map(tag => (
          <li key={tag}>
            <button
              type="button"
              className="doc-picker__tag-chip"
              aria-label={`Remove tag ${tag}`}
              // mousedown, not click: the field's own blur commits and closes,
              // and a click would arrive after this button had gone.
              onMouseDown={event => {
                event.preventDefault()
                apply(current.filter(candidate => candidate !== tag))
              }}
            >
              {tag}
              {/* The drawn cross, not ×: a typed glyph resolves through
                  whatever fallback font the OS picks and never lines up with
                  the text beside it. */}
              <CloseIcon className="doc-picker__tag-remove" />
            </button>
          </li>
        ))}
      </ul>

      {/* Focused on mount: the field only exists because the user just clicked
          Tags to type in it. */}
      <input
        autoFocus
        className="doc-picker__tag-input"
        aria-label={`Tags for ${title}`}
        placeholder="tag, another tag"
        value={draft}
        onChange={event => {
          const value = event.target.value
          // A typed comma is a commit, not a character — otherwise it would sit
          // in the field and end up inside the next tag's name.
          if (value.includes(',')) commit(value)
          else setDraft(value)
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            // The drawer listens for Escape on the document and would close
            // itself over this; leaving the field is the smaller thing meant.
            event.stopPropagation()
            abandoned.current = true
            onClose()
            return
          }
          // Backspace on an empty field takes back the last chip, which is what
          // every tag field anywhere does.
          if (event.key === 'Backspace' && !draft && current.length) {
            event.preventDefault()
            apply(current.slice(0, -1))
          }
        }}
        onBlur={finish}
      />
    </form>
  )
}
