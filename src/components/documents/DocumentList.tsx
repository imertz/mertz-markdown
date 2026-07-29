import { useCallback, useRef, useState } from 'react'
import { useDismissable } from '../../hooks/useDismissable'
import { relative } from '../../lib/time'
import type { DocumentRecord } from '../../types'
import { PencilIcon, TrashIcon } from '../icons'

interface DocumentListProps {
  documents: DocumentRecord[]
  trashed: DocumentRecord[]
  activeId: string | null
  activeTitle: string
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onDestroy: (id: string) => void
  /** An empty name hands the title back to the content. */
  onRename: (id: string, name: string) => void
}

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
}: DocumentListProps) {
  const [open, setOpen] = useState(false)
  // Which trashed document is one more click away from being gone for good.
  const [confirming, setConfirming] = useState<string | null>(null)
  // Which document is being renamed, and the name so far.
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // Escape unmounts the field, and an unmounting field must not also save what
  // the user just abandoned.
  const abandoned = useRef(false)

  const stopRenaming = useCallback(() => {
    setRenaming(null)
    setDraft('')
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setConfirming(null)
    setRenaming(null)
    setDraft('')
  }, [])
  const container = useDismissable<HTMLDivElement>(open, close)

  const commitRename = useCallback(
    (id: string) => {
      if (abandoned.current) return
      onRename(id, draft)
      stopRenaming()
    },
    [draft, onRename, stopRenaming],
  )

  return (
    <div className="doc-picker" ref={container}>
      <button
        type="button"
        className="doc-picker__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(value => !value)}
      >
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

          <ul className="doc-picker__list">
            {documents.map(document_ =>
              renaming === document_.id ? (
                <li key={document_.id} className="doc-picker__item">
                  <form
                    className="doc-picker__rename-form"
                    onSubmit={event => {
                      event.preventDefault()
                      commitRename(document_.id)
                    }}
                  >
                    {/* Focused on mount: the field only exists because the
                        user just clicked Rename to type in it. */}
                    <input
                      autoFocus
                      className="doc-picker__rename-input"
                      aria-label={`Name for ${document_.title}`}
                      placeholder="Name from the first heading"
                      value={draft}
                      onChange={event => setDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key !== 'Escape') return
                        // The menu's own Escape handler sits on the document
                        // and would close the whole picker; cancelling the
                        // rename is the smaller thing the user meant.
                        event.stopPropagation()
                        abandoned.current = true
                        stopRenaming()
                      }}
                      onBlur={() => commitRename(document_.id)}
                    />
                  </form>
                </li>
              ) : (
                <li key={document_.id} className="doc-picker__item">
                  <button
                    type="button"
                    className="doc-picker__select"
                    aria-current={document_.id === activeId}
                    onClick={() => {
                      onSelect(document_.id)
                      close()
                    }}
                  >
                    <span className="doc-picker__item-title">
                      {document_.title}
                    </span>
                    <span className="doc-picker__item-time">
                      {relative(document_.updatedAt)}
                    </span>
                  </button>
                  {/*
                    Seeded with the override rather than the shown title, so
                    opening the field on a document that never had a name of
                    its own offers an empty box instead of the derived text —
                    submitting that text unchanged would silently pin it.
                  */}
                  <button
                    type="button"
                    className="doc-picker__rename"
                    aria-label={`Rename ${document_.title}`}
                    title="Rename"
                    onClick={() => {
                      abandoned.current = false
                      setDraft(document_.titleOverride ?? '')
                      setRenaming(document_.id)
                    }}
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    className="doc-picker__delete"
                    aria-label={`Move ${document_.title} to trash`}
                    title="Move to trash"
                    onClick={() => onDelete(document_.id)}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ),
            )}
          </ul>

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
