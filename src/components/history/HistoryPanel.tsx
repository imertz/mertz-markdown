import { useEffect, useMemo, useState } from 'react'
import { listSnapshots } from '../../db/snapshots'
import { listConflicts } from '../../sync/local'
import { useDismissable } from '../../hooks/useDismissable'
import { collapseUnchanged, diffStats, lineDiff } from '../../lib/lineDiff'
import { relative } from '../../lib/time'
import type { SnapshotCause, SnapshotRecord, SyncConflictRecord } from '../../types'
import { CloseIcon } from '../icons'

interface HistoryPanelProps {
  docId: string
  /**
   * The live markdown, serialized from the editor — not the saved copy, so the
   * diff never trails the last keystroke by the autosave delay.
   */
  current: string
  onRestore: (snapshot: SnapshotRecord) => void
  onRestoreConflict?: (conflict: SyncConflictRecord) => void
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
  onRestoreConflict,
  onClose,
}: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotRecord[] | null>(null)
  const [conflicts, setConflicts] = useState<SyncConflictRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const container = useDismissable<HTMLDivElement>(true, onClose)

  useEffect(() => {
    let cancelled = false
    void Promise.all([listSnapshots(docId), listConflicts(docId)]).then(([loaded, remote]) => {
      if (cancelled) return
      setSnapshots(loaded)
      setConflicts(remote)
      const newest = [
        ...loaded.map(record => ({ id: record.id, time: record.createdAt })),
        ...remote.map(record => ({ id: record.id, time: record.changedAt })),
      ].sort((a, b) => b.time - a.time)[0]
      setSelectedId(newest?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [docId])

  const entries = useMemo(
    () => [
      ...(snapshots ?? []).map(record => ({ kind: 'snapshot' as const, record })),
      ...conflicts.map(record => ({ kind: 'conflict' as const, record })),
    ].sort((a, b) => {
      const aTime = a.kind === 'snapshot' ? a.record.createdAt : a.record.changedAt
      const bTime = b.kind === 'snapshot' ? b.record.createdAt : b.record.changedAt
      return bTime - aTime
    }),
    [conflicts, snapshots],
  )
  const selected = entries.find(entry => entry.record.id === selectedId) ?? null
  const selectedMarkdown = selected
    ? selected.kind === 'snapshot'
      ? selected.record.markdown
      : selected.record.package.document.markdown
    : ''

  const rows = useMemo(
    () => (selected ? lineDiff(selectedMarkdown, current) : []),
    [selected, selectedMarkdown, current],
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
        ) : entries.length === 0 ? (
          <p className="history__empty">
            No versions yet. One is kept every few minutes as you write.
          </p>
        ) : (
          <div className="history__body">
            <ul className="history__list" aria-label="Versions">
              {entries.map(entry => (
                <li key={entry.record.id}>
                  <button
                    type="button"
                    className="history__entry"
                    aria-current={entry.record.id === selectedId}
                    onClick={() => setSelectedId(entry.record.id)}
                  >
                    <span className="history__when">
                      {relative(
                        entry.kind === 'snapshot'
                          ? entry.record.createdAt
                          : entry.record.changedAt,
                      )}
                    </span>
                    <span className="history__cause">
                      {entry.kind === 'snapshot'
                        ? CAUSE_LABEL[entry.record.cause]
                        : `Sync conflict · ${entry.record.deviceLabel}`}
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
                    onClick={() => {
                      if (selected.kind === 'snapshot') onRestore(selected.record)
                      else onRestoreConflict?.(selected.record)
                    }}
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
