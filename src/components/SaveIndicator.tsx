import type { SaveStatus } from '../hooks/useDocuments'
import type { PersistenceState } from '../hooks/usePersistentStorage'
import type { SyncStatus } from '../sync/types'
import { formatBytes, relative } from '../lib/time'

const STATUS_LABEL = {
  loading: 'Loading…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
} as const

const DURABILITY_HINT = {
  persisted: 'Storage is persistent — the browser will not evict your documents.',
  'best-effort':
    'Storage is best-effort; the browser may evict data under pressure.',
  unknown: 'Storage durability is still being determined.',
} as const

interface SaveIndicatorProps {
  status: SaveStatus
  persistence: PersistenceState
  /** When the open document was last written, for the "Saved 2m ago" label. */
  savedAt?: number | null
  /** Bytes this origin occupies, surfaced only in the tooltip. */
  usage?: number | null
  syncStatus?: SyncStatus
}

/**
 * Save state as a colour-carrying dot plus a label.
 *
 * Durability is a permanent property, separate from the transient save state,
 * so it no longer rides along in the label text ("Saved · best-effort
 * storage"). A best-effort dot is drawn as a hollow ring instead, with the
 * explanation in the tooltip — noticeable, but not permanent noise.
 *
 * The timestamp is only attached to `saved`: while a write is in flight the
 * interesting fact is the write, not how long ago the last one landed. The
 * label does not tick on its own — the status bar re-renders it periodically.
 */
export function SaveIndicator({
  status,
  persistence,
  savedAt,
  usage,
  syncStatus = 'disabled',
}: SaveIndicatorProps) {
  const localLabel =
    status === 'saved' && savedAt
      ? `${STATUS_LABEL.saved} ${relative(savedAt)}`
      : STATUS_LABEL[status]
  const syncLabel =
    syncStatus === 'disabled'
      ? ''
      : syncStatus === 'idle'
        ? ' · Synced'
        : syncStatus === 'syncing'
          ? ' · Syncing…'
          : syncStatus === 'offline'
            ? ' · Queued'
            : ' · Sync failed'
  const label = `${localLabel}${syncLabel}`

  const title = [
    `${STATUS_LABEL[status]}.`,
    DURABILITY_HINT[persistence],
    usage != null ? `${formatBytes(usage)} in use.` : '',
    syncStatus === 'disabled' ? '' : `Vault: ${syncLabel.slice(3) || 'enabled'}.`,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      className="save-indicator"
      data-status={status}
      data-durability={persistence}
      title={title}
    >
      <span className="save-indicator__dot" aria-hidden="true" />
      <span>{label}</span>
      {/* The ring is a purely visual cue, so state the caveat non-visually too. */}
      {persistence === 'best-effort' ? (
        <span className="sr-only"> — best-effort storage</span>
      ) : null}
    </span>
  )
}
