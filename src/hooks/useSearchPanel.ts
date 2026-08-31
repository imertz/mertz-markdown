import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseSearchQuery } from '../search/query'
import { searchPassages } from '../search/store'
import type { PassageSource, SearchResults } from '../search/types'
import { foldLabel, normalizeTags } from '../lib/labels'
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
  projectFilter: string | null | undefined
  setProjectFilter: (value: string | null | undefined) => void
  tagFilters: string[]
  setTagFilters: (value: string[]) => void
  toggleTagFilter: (tag: string) => void
  clearFilters: () => void
  effectiveProject: string | null | undefined
  effectiveTags: string[]
  cleanTerm: string
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
  const [projectFilter, setProjectFilter] = useState<string | null | undefined>(undefined)
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [results, setResults] = useState<SearchResults | null>(null)
  const [searching, setSearching] = useState(false)

  const flushed = useRef(false)
  // Only the newest query may write results: an earlier, slower one landing
  // afterwards would show answers to a question the user has moved on from.
  const generation = useRef(0)

  const parsedQuery = useMemo(() => parseSearchQuery(query), [query])

  const effectiveProject = projectFilter !== undefined ? projectFilter : parsedQuery.project
  const effectiveTags = useMemo(
    () => normalizeTags([...tagFilters, ...parsedQuery.tags]),
    [tagFilters, parsedQuery.tags],
  )
  const cleanTerm = parsedQuery.term

  const toggleTagFilter = useCallback((tag: string) => {
    const key = foldLabel(tag)
    setTagFilters(current =>
      current.some(c => foldLabel(c) === key)
        ? current.filter(c => foldLabel(c) !== key)
        : [...current, tag],
    )
  }, [])

  const clearFilters = useCallback(() => {
    setProjectFilter(undefined)
    setTagFilters([])
    // If the query text had inline directives like project:foo or #tag, clean them out
    if (parsedQuery.project !== undefined || parsedQuery.tags.length > 0) {
      setQuery(cleanTerm)
    }
  }, [parsedQuery, cleanTerm])

  const run = useCallback(
    async (
      term: string,
      currentScope: SearchScope,
      project: string | null | undefined,
      tags: string[],
    ) => {
      const ticket = (generation.current += 1)
      const hasFilter = project !== undefined || tags.length > 0

      if (!term.trim() && !hasFilter) {
        setResults(null)
        setSearching(false)
        return
      }

      if (!flushed.current) {
        flushed.current = true
        await flushPendingWrites()
      }

      try {
        const next = await searchPassages(term, {
          ...scopeOptions(currentScope),
          project,
          tags: tags.length ? tags : undefined,
        })
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
    const hasFilter = effectiveProject !== undefined || effectiveTags.length > 0
    if (!cleanTerm.trim() && !hasFilter) {
      // An emptied field with no filters must not leave the previous answer on screen,
      // and the in-flight query for it must not be allowed to land either.
      cancel()
      generation.current += 1
      setResults(null)
      setSearching(false)
      return
    }
    // Invalidate a query already in flight during the debounce window.
    generation.current += 1
    setSearching(true)
    schedule(cleanTerm, scope, effectiveProject, effectiveTags)
  }, [
    cleanTerm,
    scope,
    effectiveProject,
    effectiveTags,
    storageRevision,
    schedule,
    cancel,
  ])

  return {
    query,
    setQuery,
    scope,
    setScope,
    projectFilter,
    setProjectFilter,
    tagFilters,
    setTagFilters,
    toggleTagFilter,
    clearFilters,
    effectiveProject,
    effectiveTags,
    cleanTerm,
    results,
    searching,
  }
}
