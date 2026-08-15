import { useState } from 'react'
import { foldLabel, normalizeTag } from '../../lib/labels'
import type { LabelCount } from '../../lib/library'
import { CloseIcon, PencilIcon } from '../icons'

interface TagFilterBarProps {
  tags: readonly LabelCount[]
  /** Selected chips, AND-combined by the caller. */
  selected: readonly string[]
  onToggle: (tag: string) => void
  /** Drops every selected chip. Called on the way into manage mode — see below. */
  onClearSelection: () => void
  /** `null` removes the tag from every document carrying it. */
  onRename: (from: string, to: string | null) => void
}

/**
 * The chip row: filtering by tag, and — behind one toggle — editing the tags
 * themselves.
 *
 * Both live here because a tag has no other home. There is no tag store to
 * open, so the only place a tag can be renamed is the one place every tag is
 * listed, and the only way to make that not collide with clicking a chip to
 * filter is a mode.
 */
export function TagFilterBar({
  tags,
  selected,
  onToggle,
  onClearSelection,
  onRename,
}: TagFilterBarProps) {
  const [managing, setManaging] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  if (!tags.length) return null

  const isSelected = (tag: string) =>
    selected.some(candidate => foldLabel(candidate) === foldLabel(tag))

  const commit = (from: string) => {
    const next = normalizeTag(draft)
    // An unchanged name is not an edit, and an emptied one is a deletion the
    // user should have to ask for explicitly — the cross does that.
    if (next && foldLabel(next) !== foldLabel(from)) onRename(from, next)
    setEditing(null)
    setDraft('')
  }

  return (
    <div className="doc-picker__chips">
      {/* The chips flow and wrap inside their own track; the manage control
          keeps the corner beside them rather than being carried along to the
          end of whatever the last line turns out to be. */}
      <div className="doc-picker__chips-flow">
        {tags.map(tag =>
          managing && editing === tag.name ? (
            <form
              key={tag.name}
              className="doc-picker__chip-form"
              onSubmit={event => {
                event.preventDefault()
                commit(tag.name)
              }}
            >
              <input
                autoFocus
                className="doc-picker__chip-input"
                aria-label={`Rename tag ${tag.name}`}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key !== 'Escape') return
                  // The drawer's Escape would close the whole sidebar;
                  // leaving this field is the smaller thing meant.
                  event.stopPropagation()
                  setEditing(null)
                  setDraft('')
                }}
                onBlur={() => commit(tag.name)}
              />
            </form>
          ) : (
            <span key={tag.name} className="doc-picker__chip-group">
              <button
                type="button"
                className="doc-picker__chip"
                aria-pressed={managing ? undefined : isSelected(tag.name)}
                aria-label={
                  managing
                    ? `Rename tag ${tag.name}`
                    : `Filter by ${tag.name} (${tag.count})`
                }
                onClick={() => {
                  if (!managing) {
                    onToggle(tag.name)
                    return
                  }
                  setDraft(tag.name)
                  setEditing(tag.name)
                }}
              >
                {tag.name}
                <span className="doc-picker__chip-count">{tag.count}</span>
              </button>

              {managing ? (
                <button
                  type="button"
                  className="doc-picker__chip-remove"
                  aria-label={`Delete tag ${tag.name} everywhere`}
                  title="Delete everywhere"
                  onClick={() => onRename(tag.name, null)}
                >
                  <CloseIcon />
                </button>
              ) : null}
            </span>
          ),
        )}
      </div>

      <button
        type="button"
        className="doc-picker__chips-manage"
        aria-pressed={managing}
        aria-label={managing ? 'Done editing tags' : 'Edit tags'}
        title={managing ? 'Done' : 'Edit tags'}
        onClick={() => {
          const next = !managing
          // Entering manage mode drops the filter. In here a chip is a rename
          // target, not a switch, so it stops showing itself as pressed — and a
          // list left quietly narrowed with nothing lit to explain why would be
          // lying about how many documents there are.
          if (next) onClearSelection()
          setManaging(next)
          setEditing(null)
        }}
      >
        <PencilIcon />
      </button>
    </div>
  )
}
