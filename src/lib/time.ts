/**
 * Coarse relative time — "just now", "5m ago", "3h ago", "2d ago".
 *
 * Deliberately imprecise. Every consumer renders it inside a card or a status
 * line that is not re-rendered on a timer fine enough to justify seconds, and a
 * ticking clock in the corner of a writing surface is a distraction.
 */
export function relative(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * How precisely to say when, given that something else has already said
 * roughly when.
 *
 * `relative` above answers "how long ago" for a row standing on its own. These
 * are for rows standing under a dated heading, where "how long ago" is what the
 * heading already said: nine rows reading "20m ago" under TODAY are a column of
 * noise, and the same nine reading 09:14, 11:02, 14:30 are a morning's work.
 */
export type TimeScale = 'clock' | 'weekday' | 'date'

/**
 * The reader's own formats, not ours: a 24-hour clock, whether the day or the
 * month comes first, and the names of the months are all things the browser
 * knows about them and we do not.
 */
export function scaled(
  timestamp: number,
  scale: TimeScale,
  now: number = Date.now(),
): string {
  const date = new Date(timestamp)

  if (scale === 'clock') {
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  if (scale === 'weekday') {
    return date.toLocaleDateString(undefined, { weekday: 'short' })
  }

  // The year is only worth its width when it is not the current one — which is
  // also the only time its absence would be ambiguous.
  return date.getFullYear() === new Date(now).getFullYear()
    ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * Byte size for the storage tooltip. Decimal units, because that is what
 * browsers report `navigator.storage.estimate()` in and what their own settings
 * UIs show back to the user.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const exponent = Math.min(
    Math.floor(Math.log10(bytes) / 3),
    UNITS.length - 1,
  )
  const value = bytes / 1000 ** exponent

  // Bytes are never fractional; larger units get one decimal until they reach
  // three digits, where the extra precision is just noise.
  const decimals = exponent === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(decimals)} ${UNITS[exponent]}`
}

const BINARY_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const

/**
 * Binary sibling of `formatBytes`, for the vault allowance.
 *
 * Kept separate rather than made a flag: the two exist for opposite reasons.
 * `formatBytes` is decimal to match what the browser reports about local disk;
 * the vault quota is a server constant defined in MiB, so rendering it decimal
 * would print "524.3 MB" under a heading that says the limit is 500 MiB.
 */
export function formatBinaryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const exponent = Math.min(
    Math.floor(Math.log2(bytes) / 10),
    BINARY_UNITS.length - 1,
  )
  const value = bytes / 1024 ** exponent
  const decimals = exponent === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(decimals)} ${BINARY_UNITS[exponent]}`
}
