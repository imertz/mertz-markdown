import { useCallback, useEffect, useRef, useState } from 'react'
import { searchPassages } from '../search/store'
import type { PassageSource, SearchResults } from '../search/types'
import { useDebouncedCallback } from './useDebouncedCallback'

/**
 * Query state for the search panel.
 *
 * Its own hook rather than more state in AppShell, which is already long
 * enough, and because the ordering rules below are easy to get wrong inline.
 */

const QUERY_DELAY_MS = 120

export type SearchScope = 'all' | PassageSource | 'trash'

export interface SearchPanelApi {
  query: string
  setQuery: (value: string) => void
  scope: SearchScope
  setScope: (value: SearchScope) => void
  results: SearchResults | null
  /** True until the first results for the current query land. */
  searching: boolean
}

const scopeOptions = (scope: SearchScope) => ({
  includeTrashed: scope === 'trash',
  source: scope === 'document' || scope === 'comment' ? scope : undefined,
})

/**
 * @param flushPendingWrites Runs before the first query, so text typed inside
 * the autosave delay is already in the database — and therefore in the index —
 * before anything is searched for. Without it the most recent edit is exactly
 * the one search cannot find.
 * @param storageRevision Changes after vault sync replaces local storage, so an
 * open panel reruns its current query against the rebuilt index.
 */
export function useSearchPanel(
  flushPendingWrites: () => Promise<void>,
  storageRevision: number,
): SearchPanelApi {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('all')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [searching, setSearching] = useState(false)

  const flushed = useRef(false)
  // Only the newest query may write results: an earlier, slower one landing
  // afterwards would show answers to a question the user has moved on from.
  const generation = useRef(0)

  const run = useCallback(
    async (term: string, current: SearchScope) => {
      const ticket = (generation.current += 1)

      if (!term.trim()) {
        setResults(null)
        setSearching(false)
        return
      }

      if (!flushed.current) {
        flushed.current = true
        await flushPendingWrites()
      }

      try {
        const next = await searchPassages(term, scopeOptions(current))
        if (ticket === generation.current) setResults(next)
      } catch (error) {
        console.error('[search] query failed', error)
        if (ticket === generation.current) setResults(null)
      } finally {
        if (ticket === generation.current) setSearching(false)
      }
    },
    [flushPendingWrites],
  )

  const { schedule, cancel } = useDebouncedCallback(run, QUERY_DELAY_MS)

  useEffect(() => {
    if (!query.trim()) {
      // An emptied field must not leave the previous answer on screen, and the
      // in-flight query for it must not be allowed to land either.
      cancel()
      generation.current += 1
      setResults(null)
      setSearching(false)
      return
    }
    // Invalidate a query already in flight during the debounce window.
    generation.current += 1
    setSearching(true)
    schedule(query, scope)
  }, [query, scope, storageRevision, schedule, cancel])

  return { query, setQuery, scope, setScope, results, searching }
}
