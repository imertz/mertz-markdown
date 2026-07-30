import { create, insertMultiple, removeMultiple, search } from 'zbsearch'
import { getDocument, listDocuments, listTrashedDocuments } from '../db/documents'
import { listAllComments, listCommentsForDoc } from '../db/threads'
import type { DocumentRecord } from '../types'
import { collectCommentPassages, collectPassages } from './passages'
import { SEARCH_SCHEMA, searchProperties } from './schema'
import { searchTokenizer } from './tokenizer'
import type {
  PassageDoc,
  PassageHit,
  SearchFacets,
  SearchGroup,
  SearchResults,
} from './types'

/**
 * The search index.
 *
 * One invariant holds the whole design up:
 *
 *   **The index is derived from IndexedDB, and every mutation writes to
 *   IndexedDB before it touches the index.**
 *
 * So a full rebuild is always the truth, and the incremental updates below are
 * a pure optimisation that cannot corrupt anything. It is also why
 * `reindexDocument` can simply return when the index has not been built yet:
 * `putDocument` already landed, so the eventual build picks the record up.
 *
 * In memory only. Persisting it would mean a second source of truth that can
 * diverge from `documents` *silently* — search just quietly returns yesterday's
 * text — in exchange for saving a rebuild measured in milliseconds.
 */

type Index = ReturnType<typeof create<typeof SEARCH_SCHEMA>>

/** Enough to group well; past this the query is the better tool. */
const RESULT_LIMIT = 60
/** Below this length, edit distance 1 matches almost anything. */
const TOLERANCE_MIN_LENGTH = 4

let index: Index | null = null
let building: Promise<Index> | null = null

/** Which record ids belong to a document, so removal never needs a search. */
const idsByDoc = new Map<string, string[]>()

const newIndex = (): Index =>
  create({
    schema: SEARCH_SCHEMA,
    // The built tokenizer, not a config object, so the snippet highlighter can
    // normalise words through the very same pipeline. Note this is also why
    // `language` is not passed at the top level: create() rejects being given
    // both a language and a components.tokenizer.
    components: { tokenizer: searchTokenizer },
  })

async function addPassages(target: Index, passages: PassageDoc[]) {
  if (!passages.length) return
  await insertMultiple(target, passages)
  for (const passage of passages) {
    const bucket = idsByDoc.get(passage.docId)
    if (bucket) bucket.push(passage.id)
    else idsByDoc.set(passage.docId, [passage.id])
  }
}

async function build(): Promise<Index> {
  const fresh = newIndex()
  idsByDoc.clear()

  const [live, trashed, commentsByDoc] = await Promise.all([
    listDocuments(),
    listTrashedDocuments(),
    listAllComments(),
  ])

  for (const record of [...live, ...trashed]) {
    await addPassages(fresh, [
      ...collectPassages(record),
      ...collectCommentPassages(record, commentsByDoc.get(record.id) ?? []),
    ])
  }

  index = fresh
  return fresh
}

/**
 * Build on first use, and only once.
 *
 * The in-flight promise is cached rather than just the result, so two callers
 * racing at boot — StrictMode double-invoking an effect, say — share one build
 * instead of racing two into the same `idsByDoc`.
 */
export function ensureIndex(): Promise<Index> {
  if (index) return Promise.resolve(index)
  building ??= build().finally(() => {
    building = null
  })
  return building
}

/** Drop everything. Tests need it; nothing in the app does. */
export function resetIndex(): void {
  index = null
  building = null
  idsByDoc.clear()
}

async function replaceDocument(target: Index, record: DocumentRecord, passages: PassageDoc[]) {
  const previous = idsByDoc.get(record.id)
  // ZBSearch's `update` is remove-then-insert anyway, and doing it wholesale
  // means a document that lost a paragraph does not leave the old one behind.
  if (previous?.length) await removeMultiple(target, previous)
  idsByDoc.delete(record.id)
  await addPassages(target, passages)
}

/**
 * Bring one document's passages back in line with what was just written.
 *
 * Returns immediately when the index has not been built, which is correct
 * rather than a shortcut — see the invariant at the top of this file.
 */
export async function reindexDocument(record: DocumentRecord): Promise<void> {
  if (!index) return
  const comments = await listCommentsForDoc(record.id)
  await replaceDocument(index, record, [
    ...collectPassages(record),
    ...collectCommentPassages(record, comments),
  ])
}

/**
 * Reindex by id, for callers that changed something hanging off a document
 * rather than the document itself — a comment written or deleted.
 *
 * Recomputing the document's passages too is deliberate: they are cheap, and
 * one code path is easier to trust than two that must agree.
 */
export async function reindexDocumentById(docId: string): Promise<void> {
  if (!index) return
  const record = await getDocument(docId)
  if (record) await reindexDocument(record)
}

/** Forget a document entirely — the permanent, cascading delete. */
export async function dropDocument(docId: string): Promise<void> {
  if (!index) return
  const previous = idsByDoc.get(docId)
  if (previous?.length) await removeMultiple(index, previous)
  idsByDoc.delete(docId)
}

interface QueryOptions {
  /** Include trashed documents. Off by default. */
  includeTrashed?: boolean
  /** Restrict to one corpus. */
  source?: 'document' | 'comment'
}

const emptyResults = (): SearchResults => ({
  groups: [],
  facets: { documents: 0, comments: 0, trashed: 0 },
  total: 0,
})

export async function searchPassages(
  term: string,
  options: QueryOptions = {},
): Promise<SearchResults> {
  const trimmed = term.trim()
  if (!trimmed) return emptyResults()

  const target = await ensureIndex()
  const terms = trimmed.split(/\s+/)

  const where: Record<string, unknown> = {}
  if (!options.includeTrashed) where.trashed = false
  if (options.source) where.source = { eq: options.source }

  const results = await search(target, {
    term: trimmed,
    properties: searchProperties(),
    limit: RESULT_LIMIT,
    where,
    /*
     * Require every term. Without this, "quarterly review" returns everything
     * containing just "review" — the failure the threshold docs describe, and
     * the single biggest relevance lever available here.
     */
    threshold: 0,
    // Typo tolerance only where it cannot swamp the result: on a three-letter
    // term, edit distance 1 matches most of the dictionary.
    ...(terms.length === 1 && trimmed.length >= TOLERANCE_MIN_LENGTH
      ? { tolerance: 1 }
      : {}),
    // Counted over the whole match set rather than the returned page, which is
    // the entire reason to use facets instead of counting hits.
    facets: { source: {}, trashed: { true: true, false: true } },
  })

  return {
    groups: groupByDocument(results.hits),
    facets: readFacets(results.facets),
    total: results.count,
  }
}

/**
 * Group hits by document, keeping BM25 order.
 *
 * Documents therefore come out ordered by their best passage, and passages
 * within a document by their own score. ZBSearch's `groupBy` cannot do this —
 * it refuses enum properties, and `docId` has to be an enum — but nor would it
 * have defined the order between groups, which is the part the UI needs.
 */
function groupByDocument(hits: readonly { document: unknown; score: number }[]): SearchGroup[] {
  const groups = new Map<string, SearchGroup>()

  for (const hit of hits) {
    const passage = hit.document as PassageDoc
    const existing = groups.get(passage.docId)
    const entry: PassageHit = { passage, score: hit.score }

    if (existing) existing.hits.push(entry)
    else {
      groups.set(passage.docId, {
        docId: passage.docId,
        title: passage.title,
        updatedAt: passage.updatedAt,
        trashed: passage.trashed,
        hits: [entry],
      })
    }
  }

  return [...groups.values()]
}

function readFacets(facets: unknown): SearchFacets {
  const read = (group: unknown, key: string): number => {
    const values = (group as { values?: Record<string, number> } | undefined)?.values
    return values?.[key] ?? 0
  }
  const all = facets as Record<string, unknown> | undefined

  return {
    documents: read(all?.source, 'document'),
    comments: read(all?.source, 'comment'),
    trashed: read(all?.trashed, 'true'),
  }
}
