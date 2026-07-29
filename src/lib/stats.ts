/**
 * Word and reading-time arithmetic for the status bar.
 *
 * Kept as plain string functions rather than reaching for TipTap's
 * CharacterCount extension. That extension ships inside `@tiptap/extensions`
 * (already a dependency) but registering it would mean editing
 * `buildExtensions()`, which is the schema source of truth shared by the live
 * editor, the DOM-free MarkdownManager and schema-lock.test.ts. The selection
 * readout needs `doc.textBetween(from, to)` regardless, so one helper covers
 * both the whole document and a selection, and the schema stays untouched.
 */

/** Words per minute. The usual figure for silent reading of prose. */
const READING_WPM = 200

/**
 * Count words in text extracted by `doc.textBetween(…, ' ', ' ')`.
 *
 * Splitting on whitespace is enough because textBetween is called with a space
 * as both the block and leaf separator, so block boundaries arrive already
 * separated rather than running two words together.
 */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return trimmed.split(/\s+/).length
}

/** Reading time in whole minutes. Never rounds a non-empty document down to 0. */
export function readingMinutes(words: number): number {
  if (words <= 0) return 0
  return Math.max(1, Math.round(words / READING_WPM))
}
