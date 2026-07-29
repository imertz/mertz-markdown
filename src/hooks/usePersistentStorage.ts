import { useEffect, useState } from 'react'

export type PersistenceState = 'unknown' | 'persisted' | 'best-effort'

/**
 * Ask the browser to exempt our origin from storage eviction.
 *
 * This matters more than it sounds: without a persisted grant, Safari clears
 * IndexedDB after 7 days without interaction, which would silently destroy
 * every document the user has written. Chrome grants it based on engagement,
 * Firefox prompts. A refusal is not an error — it just means best-effort.
 */
export function usePersistentStorage(): PersistenceState {
  const [state, setState] = useState<PersistenceState>('unknown')

  useEffect(() => {
    let cancelled = false

    const request = async () => {
      if (!navigator.storage?.persist) return
      try {
        const already = await navigator.storage.persisted()
        const granted = already ? true : await navigator.storage.persist()
        if (!cancelled) setState(granted ? 'persisted' : 'best-effort')
      } catch {
        if (!cancelled) setState('best-effort')
      }
    }

    void request()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
