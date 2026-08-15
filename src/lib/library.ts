import type { DocumentRecord } from '../types'
import { fuzzyMatch } from './fuzzy'
import { foldLabel, hasTag } from './labels'

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
