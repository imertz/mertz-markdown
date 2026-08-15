import type { DocumentRecord } from '../types'
import { fuzzyMatch } from './fuzzy'
import { foldLabel, hasTag } from './labels'
import { UNTITLED } from './title'

/**
 * Deriving the shape of the library from the documents themselves.
 *
 * There is no project store and no tag store. Every project and every tag that
 * exists is one some document is carrying right now, which is what lets the
 * whole feature ride inside the document record — and therefore inside the
 * encrypted sync package — without a schema of its own.
 *
 * All pure, all over the list the caller already holds. `useDocuments` loads
 * every live document anyway, so none of this costs a database read.
 */

export interface LabelCount {
  /** As first spelled by a document carrying it. */
  name: string
  count: number
}

export interface ProjectGroup {
  /** `null` is the unfiled group, and always sorts last. */
  project: string | null
  documents: DocumentRecord[]
}

export interface RecencyBucket {
  /** Stable across renders and locales; `label` is the part that is shown. */
  key: 'today' | 'yesterday' | 'week' | 'earlier'
  label: string
  documents: DocumentRecord[]
}

export interface LibraryFilter {
  /** Fuzzy-matched against the title. */
  query?: string
  /** AND semantics: a document must carry every one of them. */
  tags?: readonly string[]
}

/** Count by folded key, but remember the first spelling seen for display. */
function tally(values: Iterable<string>): Map<string, LabelCount> {
  const counts = new Map<string, LabelCount>()
  for (const value of values) {
    const key = foldLabel(value)
    const existing = counts.get(key)
    if (existing) existing.count += 1
    else counts.set(key, { name: value, count: 1 })
  }
  return counts
}

/** Every project in use, alphabetical. */
export function collectProjects(
  documents: readonly DocumentRecord[],
): LabelCount[] {
  const projects = documents.flatMap(record =>
    record.project ? [record.project] : [],
  )
  return [...tally(projects).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

/**
 * Every tag in use, most-used first.
 *
 * Not alphabetical: these render as a single row of chips that will wrap or
 * clip, so the ones actually worth clicking have to be the ones that survive.
 */
export function collectTags(documents: readonly DocumentRecord[]): LabelCount[] {
  const tags = documents.flatMap(record => record.tags ?? [])
  return [...tally(tags).values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  )
}

/**
 * Bucket documents by project, projects alphabetical and unfiled last.
 *
 * Document order inside a group is whatever order it arrived in — the caller
 * passes the list already sorted by `updatedAt`, and grouping is a new view of
 * that list, not a new sort of it.
 */
export function groupByProject(
  documents: readonly DocumentRecord[],
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>()
  const unfiled: DocumentRecord[] = []

  for (const record of documents) {
    if (!record.project) {
      unfiled.push(record)
      continue
    }
    const key = foldLabel(record.project)
    const existing = groups.get(key)
    if (existing) existing.documents.push(record)
    else groups.set(key, { project: record.project, documents: [record] })
  }

  const filed = [...groups.values()].sort((a, b) =>
    (a.project ?? '').localeCompare(b.project ?? ''),
  )

  // The unfiled group is omitted entirely when empty, so a library where
  // everything is filed does not carry a permanent empty heading.
  return unfiled.length ? [...filed, { project: null, documents: unfiled }] : filed
}

/** Midnight at the start of the day `time` falls in, in the reader's zone. */
function startOfDay(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const DAY_MS = 86_400_000

/**
 * Cut a group into "today", "yesterday", "last 7 days" and "earlier".
 *
 * A partition, not a sort: the caller's list is already newest-first, so each
 * bucket keeps that order and the buckets themselves come out in it too. What
 * this buys is landmarks — eighteen rows that all say "just now" are a wall,
 * and the same eighteen under four dated headings are four short lists.
 *
 * Calendar days rather than rolling 24-hour windows, because "Today" has to
 * mean today: something written at 23:50 belongs to yesterday by breakfast, not
 * ten hours later. That makes these boundaries local to the reader, which is
 * also why `now` is injectable — a test that cannot say when "now" is cannot
 * say what "yesterday" means either.
 *
 * Empty buckets are dropped, so a library touched only this morning gets one
 * heading rather than four, three of them saying nothing.
 */
export function bucketByRecency(
  documents: readonly DocumentRecord[],
  now: number = Date.now(),
): RecencyBucket[] {
  const today = startOfDay(now)
  const buckets: RecencyBucket[] = [
    { key: 'today', label: 'Today', documents: [] },
    { key: 'yesterday', label: 'Yesterday', documents: [] },
    { key: 'week', label: 'Last 7 days', documents: [] },
    { key: 'earlier', label: 'Earlier', documents: [] },
  ]

  for (const record of documents) {
    const index =
      record.updatedAt >= today
        ? 0
        : record.updatedAt >= today - DAY_MS
          ? 1
          : record.updatedAt >= today - 6 * DAY_MS
            ? 2
            : 3
    buckets[index]!.documents.push(record)
  }

  return buckets.filter(bucket => bucket.documents.length > 0)
}

/**
 * A document with nothing in it and no name of its own.
 *
 * The three clauses are one question asked three ways, and all three are
 * needed. `title` is re-derived from the content on every save, so the
 * placeholder is itself the evidence that there is no first line to derive
 * from — but an image-only document derives the placeholder too and is not
 * blank, which is what `markdown` catches. And a document the user has
 * deliberately named "Untitled document" carries an override, which is a name
 * like any other.
 *
 * These are the rows the library cannot tell apart, because there is genuinely
 * nothing to tell apart: identical title, identical time. Counting them is
 * more honest than listing them.
 */
export function isBlankDraft(record: DocumentRecord): boolean {
  return (
    record.title === UNTITLED &&
    !record.titleOverride?.trim() &&
    record.markdown.trim() === ''
  )
}

/**
 * Narrow the list to what the filter box and the selected chips describe.
 *
 * The text query goes through `fuzzyMatch` rather than a substring test so the
 * box behaves like the command palette — "nd" finds "New designs" — and
 * reorders by score, because a subsequence match with nothing to rank it by
 * puts the worst matches at the top as often as not.
 */
export function filterDocuments(
  documents: readonly DocumentRecord[],
  filter: LibraryFilter = {},
): DocumentRecord[] {
  const tags = filter.tags ?? []
  const tagged = tags.length
    ? documents.filter(record => tags.every(tag => hasTag(record.tags, tag)))
    : [...documents]

  const query = filter.query?.trim() ?? ''
  if (!query) return tagged

  return tagged
    .map(record => {
      const hit = fuzzyMatch(record.title, query)
      return hit ? { record, score: hit.score } : null
    })
    .filter((row): row is { record: DocumentRecord; score: number } => row !== null)
    .sort((a, b) => b.score - a.score)
    .map(row => row.record)
}
