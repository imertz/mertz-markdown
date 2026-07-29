import { useEffect, useState } from 'react'
import type { SaveStatus } from '../hooks/useDocuments'
import type { PersistenceState } from '../hooks/usePersistentStorage'
import type { DocumentStats } from '../hooks/useDocumentStats'
import { ChevronDownIcon, ChevronUpIcon, PanelRightIcon } from './icons'
import { OutlineMenu } from './OutlineMenu'
import { SaveIndicator } from './SaveIndicator'

interface StatusBarProps {
  stats: DocumentStats
  /** Threads still open on the document; resolved ones are counted separately. */
  openCount: number
  resolvedCount: number
  orphanCount: number
  online: boolean
  status: SaveStatus
  persistence: PersistenceState
  savedAt: number | null
  usage: number | null
  railHidden: boolean
  onNextThread: () => void
  onShowOrphans: () => void
  onJumpToHeading: (index: number) => void
  onStepSection: (delta: -1 | 1) => void
  onToggleRail: () => void
}

/** "Saved 2m ago" would otherwise stay frozen at whatever the last render said. */
const TICK_MS = 30_000

const plural = (count: number, noun: string): string =>
  `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`

/**
 * The bottom bar: where the caret is, how much has been written, what still
 * needs attention, and whether it is saved.
 *
 * Everything here is passive except the two comment chips, which exist because
 * threads had no navigation at all — the only way to reach one was to find its
 * card in the rail, and orphaned threads were reachable only by scrolling to
 * the bottom of it.
 */
export function StatusBar({
  stats,
  openCount,
  resolvedCount,
  orphanCount,
  online,
  status,
  persistence,
  savedAt,
  usage,
  railHidden,
  onNextThread,
  onShowOrphans,
  onJumpToHeading,
  onStepSection,
  onToggleRail,
}: StatusBarProps) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick(value => value + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const railLabel = railHidden
    ? `Show comments${openCount > 0 ? ` (${openCount})` : ''}`
    : 'Hide comments'

  const words =
    stats.selectedWords > 0
      ? `${stats.selectedWords.toLocaleString()} of ${plural(stats.words, 'word')}`
      : plural(stats.words, 'word')

  return (
    <footer className="status-bar">
      <div className="status-bar__context">
        {/*
          Enablement is derived from the debounced outline, so it can trail the
          caret by up to the measure delay. Stepping re-reads live editor state
          and simply does nothing if there is nowhere to go, so a stale-enabled
          arrow is a no-op rather than a wrong jump.
        */}
        <button
          type="button"
          className="status-bar__step"
          aria-label="Previous section"
          title="Previous section"
          disabled={stats.activeIndex < 0}
          onClick={() => onStepSection(-1)}
        >
          <ChevronUpIcon />
        </button>

        <OutlineMenu
          outline={stats.outline}
          activeIndex={stats.activeIndex}
          onJump={onJumpToHeading}
        />

        <button
          type="button"
          className="status-bar__step"
          aria-label="Next section"
          title="Next section"
          disabled={stats.activeIndex >= stats.outline.length - 1}
          onClick={() => onStepSection(1)}
        >
          <ChevronDownIcon />
        </button>
      </div>

      <div className="status-bar__readout">
        <span className="status-bar__stat">
          {words}
          {stats.minutes > 0 ? ` · ${stats.minutes} min` : ''}
        </span>

        {openCount > 0 ? (
          <button
            type="button"
            className="status-bar__chip"
            onClick={onNextThread}
            title={
              resolvedCount > 0
                ? `${openCount} open, ${resolvedCount} resolved. Go to the next comment.`
                : 'Go to the next comment.'
            }
          >
            {plural(openCount, 'comment')}
          </button>
        ) : null}

        {orphanCount > 0 ? (
          <button
            type="button"
            className="status-bar__chip status-bar__chip--warn"
            onClick={onShowOrphans}
            title="These threads lost the text they annotated. Show them."
          >
            {orphanCount.toLocaleString()} orphaned
          </button>
        ) : null}

        {/* Absent while online rather than greyed out: a permanent "Online"
            label is noise in an app that never needed the network anyway. */}
        {online ? null : (
          <span
            className="status-bar__chip status-bar__chip--warn"
            role="status"
            title="No network. Everything still saves to this device."
          >
            Offline
          </span>
        )}

        {/*
          The count deliberately does not repeat here — the comment chip stays
          visible while the rail is hidden, so a badge would read
          "1 comment [▤ 1]". It rides in the accessible name instead, which
          also covers the case where every thread is resolved and the chip is
          gone entirely.
        */}
        <button
          type="button"
          className="status-bar__chip status-bar__chip--icon"
          aria-pressed={!railHidden}
          aria-label={railLabel}
          title={railLabel}
          onClick={onToggleRail}
        >
          <PanelRightIcon />
        </button>

        <SaveIndicator
          status={status}
          persistence={persistence}
          savedAt={savedAt}
          usage={usage}
        />
      </div>
    </footer>
  )
}
