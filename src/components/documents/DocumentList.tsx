import { useCallback, useState } from 'react'
import { useDismissable } from '../../hooks/useDismissable'
import { relative } from '../../lib/time'
import type { DocumentRecord } from '../../types'
import { TrashIcon } from '../icons'

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
}: DocumentListProps) {
  const [open, setOpen] = useState(false)
  // Which trashed document is one more click away from being gone for good.
  const [confirming, setConfirming] = useState<string | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setConfirming(null)
  }, [])
  const container = useDismissable<HTMLDivElement>(open, close)

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
            {documents.map(document_ => (
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
            ))}
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
