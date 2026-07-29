import { useEffect, useMemo, useState } from 'react'
import { listSnapshots } from '../../db/snapshots'
import { useDismissable } from '../../hooks/useDismissable'
import { collapseUnchanged, diffStats, lineDiff } from '../../lib/lineDiff'
import { relative } from '../../lib/time'
import type { SnapshotCause, SnapshotRecord } from '../../types'
import { CloseIcon } from '../icons'

interface HistoryPanelProps {
  docId: string
  /**
   * The live markdown, serialized from the editor — not the saved copy, so the
   * diff never trails the last keystroke by the autosave delay.
   */
  current: string
  onRestore: (snapshot: SnapshotRecord) => void
  onClose: () => void
}

const CAUSE_LABEL: Record<SnapshotCause, string> = {
  interval: 'Autosaved',
  restore: 'Before a restore',
  manual: 'Saved by hand',
}

export function HistoryPanel({
  docId,
  current,
  onRestore,
  onClose,
}: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotRecord[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const container = useDismissable<HTMLDivElement>(true, onClose)

  useEffect(() => {
    let cancelled = false
    void listSnapshots(docId).then(loaded => {
      if (cancelled) return
      setSnapshots(loaded)
      setSelectedId(loaded[0]?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [docId])

  const selected = snapshots?.find(record => record.id === selectedId) ?? null

  const rows = useMemo(
    () => (selected ? lineDiff(selected.markdown, current) : []),
    [selected, current],
  )
  const stats = useMemo(() => diffStats(rows), [rows])
  const folded = useMemo(() => collapseUnchanged(rows), [rows])
  const unchanged = stats.added === 0 && stats.removed === 0

  return (
    <div className="palette-backdrop">
      <div
        className="history"
        ref={container}
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
      >
        <header className="history__header">
          <h2 className="history__title">Version history</h2>
          <button
            type="button"
            className="history__close"
            aria-label="Close version history"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        {snapshots === null ? (
          <p className="history__empty">Loading…</p>
        ) : snapshots.length === 0 ? (
          <p className="history__empty">
            No versions yet. One is kept every few minutes as you write.
          </p>
        ) : (
          <div className="history__body">
            <ul className="history__list" aria-label="Versions">
              {snapshots.map(record => (
                <li key={record.id}>
                  <button
                    type="button"
                    className="history__entry"
                    aria-current={record.id === selectedId}
                    onClick={() => setSelectedId(record.id)}
                  >
                    <span className="history__when">
                      {relative(record.createdAt)}
                    </span>
                    <span className="history__cause">
                      {CAUSE_LABEL[record.cause]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="history__detail">
              <div className="history__summary">
                {unchanged ? (
                  <span>Identical to the document as it stands.</span>
                ) : (
                  <span>
                    <span className="history__added">+{stats.added}</span>{' '}
                    <span className="history__removed">−{stats.removed}</span>{' '}
                    since this version
                  </span>
                )}

                {selected ? (
                  <button
                    type="button"
                    className="btn--primary"
                    // Restoring writes a snapshot of the current state first
                    // and lands as one undoable transaction, so there is
                    // nothing here to confirm.
                    title="Replaces the document with this version. Undoable."
                    onClick={() => onRestore(selected)}
                  >
                    Restore this version
                  </button>
                ) : null}
              </div>

              <pre className="history__diff" aria-label="Changes since this version">
                {folded.map((row, index) =>
                  row.op === 'gap' ? (
                    <span key={index} className="history__gap">
                      {`⋯ ${row.count} unchanged line${row.count === 1 ? '' : 's'}\n`}
                    </span>
                  ) : (
                    <span key={index} className={`history__line--${row.op}`}>
                      {`${row.op === 'added' ? '+' : row.op === 'removed' ? '−' : ' '} ${row.text}\n`}
                    </span>
                  ),
                )}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
