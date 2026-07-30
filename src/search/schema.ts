/**
 * The index schema.
 *
 * What is *absent* matters as much as what is here. `id`, `title`, `anchor` and
 * `threadId` are written onto every record but left undeclared: ZBSearch stores
 * undeclared fields and never tokenizes them, which keeps UUIDs and document
 * titles out of the inverted index while still sparing the panel a second
 * database read per row. Declaring `id` in particular would scatter the tokens
 * of every UUID across the index.
 */
export const SEARCH_SCHEMA = {
  /**
   * `enum`, not `string`, and the distinction is load-bearing. Multilingual
   * word segmentation splits a UUID on its hyphens, so an exact-token filter on
   * a `string` docId could never match the whole thing back. `enum` compares
   * the stored value. Pinned by `src/test/search-language.test.ts`.
   *
   * The cost: ZBSearch refuses to `groupBy` an enum, so the panel groups by
   * document in plain JS instead. That was the preferred design anyway — it
   * gives documents a defined order, best passage first, which `groupBy` never
   * promised.
   */
  docId: 'enum',
  text: 'string',
  headingPath: 'string',
  kind: 'enum',
  source: 'enum',
  trashed: 'boolean',
  updatedAt: 'number',
} as const

/**
 * Only these are ever term-matched; ids and enums must not contribute.
 *
 * Mutable rather than `as const` because ZBSearch's `properties` parameter is a
 * mutable array type. Kept as a factory so no caller can reorder the shared one.
 */
export const searchProperties = (): ('text' | 'headingPath')[] => [
  'text',
  'headingPath',
]
