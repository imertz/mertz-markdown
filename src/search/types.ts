import type { TextQuoteSelector } from '../types'

/**
 * Search-only shapes.
 *
 * Deliberately not in `src/types/index.ts`: that file is the contract for what
 * IndexedDB persists, and none of this is ever written there. The index is
 * rebuilt from the documents at boot, so these types are free to change without
 * a migration.
 */

export type PassageKind =
  | 'title'
  | 'heading'
  | 'paragraph'
  | 'listItem'
  | 'codeBlock'
  | 'tableRow'
  | 'comment'

export type PassageSource = 'document' | 'comment'

/** One indexed passage, carrying everything a result row renders. */
export interface PassageDoc {
  /** `${docId}#${ordinal}`, `${docId}#title`, or `comment:${commentId}`. */
  id: string
  docId: string
  /** Searchable body. */
  text: string
  /** Enclosing headings, ' › '-joined. Searchable and shown as the row hint. */
  headingPath: string
  kind: PassageKind
  source: PassageSource
  trashed: boolean
  updatedAt: number

  // Below here: written onto the record but absent from the schema, so ZBSearch
  // stores them and never tokenizes them. Keeps UUIDs and titles out of the
  // inverted index while still sparing the panel a second database read.

  /**
   * The document's title, for the group header.
   *
   * Not searchable *here* on purpose: a document called "Search" would
   * otherwise make every one of its passages match the query "search". The
   * `kind: 'title'` record covers title matching with exactly one hit instead.
   */
  title: string
  /** Rebuilt into an editor range by `resolveSelector` when a hit is clicked. */
  anchor: TextQuoteSelector
  threadId?: string
  project?: string | null
  tags?: string[]
}

/** A passage plus its BM25 score, as the panel consumes it. */
export interface PassageHit {
  passage: PassageDoc
  score: number
}

/** Hits for one document, best passage first. */
export interface SearchGroup {
  docId: string
  title: string
  updatedAt: number
  trashed: boolean
  project?: string | null
  tags?: string[]
  hits: PassageHit[]
}

/** Facet counts over the whole match set, not just the returned page. */
export interface SearchFacets {
  documents: number
  comments: number
  trashed: number
}

export interface SearchResults {
  groups: SearchGroup[]
  facets: SearchFacets
  /** Total matching passages, before grouping. */
  total: number
}
