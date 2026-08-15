/**
 * Normalising project and tag names.
 *
 * One rule runs through all of it, and it is the only subtle part: **display
 * preserves what the user typed, comparison folds case.** Without that,
 * `Research` and `research` become two projects that look identical in the
 * menu and can never be merged from the UI that shows them.
 *
 * Pure, and deliberately free of IO — these run inside render, on every
 * keystroke in the filter box.
 */

/** Past this a name stops being a label and starts being a sentence. */
const MAX_LENGTH = 32

/** Fold for comparison only. Never store or display the result. */
export const foldLabel = (value: string): string => value.toLocaleLowerCase()

const clean = (raw: string): string | null => {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (!text) return null
  return text.length > MAX_LENGTH ? text.slice(0, MAX_LENGTH).trimEnd() : text
}

/**
 * A single tag, or `null` if there was nothing left after trimming.
 *
 * The leading `#` is stripped because the chips display one — users copy what
 * they see, and `##draft` is nobody's intent.
 */
export function normalizeTag(raw: string): string | null {
  return clean(raw.replace(/^#+/, ''))
}

/** A project name, or `null` for unfiled. No `#` handling; projects are not tags. */
export function normalizeProject(raw: string): string | null {
  return clean(raw)
}

/**
 * Clean a whole tag list: drop the empties, deduplicate case-insensitively,
 * and sort.
 *
 * First spelling wins on a duplicate. The alternative — last wins — would let
 * tagging one document `Draft` silently restyle the chip on every other
 * document that already said `draft`.
 */
export function normalizeTags(raw: readonly string[]): string[] {
  const seen = new Map<string, string>()
  for (const candidate of raw) {
    const tag = normalizeTag(candidate)
    if (!tag) continue
    const key = foldLabel(tag)
    if (!seen.has(key)) seen.set(key, tag)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/**
 * Split typed text into tags, so `draft, urgent` entered in one go becomes two.
 *
 * Commas and whitespace both separate. A tag with a space in it is therefore
 * unreachable from this field by design: the chips are meant to be glanceable,
 * and multi-word tags are what the project axis is for.
 */
export function parseTagInput(text: string): string[] {
  return normalizeTags(text.split(/[,\s]+/))
}

/** Whether a tag list contains a tag, ignoring case. */
export function hasTag(tags: readonly string[] | undefined, tag: string): boolean {
  const key = foldLabel(tag)
  return (tags ?? []).some(candidate => foldLabel(candidate) === key)
}

/** Whether two project names — either possibly absent — mean the same project. */
export function sameProject(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  // Absent and null both mean unfiled; normalising to null keeps the two
  // spellings of "no project" from reading as different projects.
  const left = a ? foldLabel(a) : null
  const right = b ? foldLabel(b) : null
  return left === right
}
