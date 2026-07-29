/**
 * How long a document must go unsnapshotted before the next save takes one.
 *
 * Autosave fires every 800 ms while typing; snapshotting each of those would
 * fill the history with keystrokes and the quota with near-identical copies.
 * Five minutes is roughly "one sitting at a paragraph" — long enough that
 * consecutive entries differ meaningfully, short enough that a mistake is
 * never more than a few minutes of work away from being undone.
 */
export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000

/** Snapshots kept per document; the oldest are pruned past this. */
export const SNAPSHOT_LIMIT = 50

/**
 * Whether a save should also take a snapshot.
 *
 * A document with no snapshots always gets one, so the first save of a new
 * document is itself a restore point.
 */
export function shouldSnapshot(lastAt: number | null, now: number): boolean {
  if (lastAt === null) return true
  return now - lastAt >= SNAPSHOT_INTERVAL_MS
}
