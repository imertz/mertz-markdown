import { useEffect, useState } from 'react'

export interface StorageEstimate {
  /** Bytes this origin is using, or `null` if the browser will not say. */
  usage: number | null
  /** Bytes this origin may use before eviction, or `null`. */
  quota: number | null
}

/** Slow on purpose: the number lives in a tooltip nobody watches change. */
const REFRESH_MS = 60_000

const EMPTY: StorageEstimate = { usage: null, quota: null }

/**
 * How much disk the documents occupy.
 *
 * Kept separate from `usePersistentStorage` even though both wrap
 * `navigator.storage`: durability is a one-shot permission request whose answer
 * does not change, while usage is a repeated measurement. Folding them together
 * would widen that hook's return type for every existing caller.
 */
export function useStorageEstimate(): StorageEstimate {
  const [estimate, setEstimate] = useState<StorageEstimate>(EMPTY)

  useEffect(() => {
    if (!navigator.storage?.estimate) return

    let cancelled = false

    const measure = async () => {
      try {
        const { usage, quota } = await navigator.storage.estimate()
        if (cancelled) return
        setEstimate(previous =>
          previous.usage === (usage ?? null) && previous.quota === (quota ?? null)
            ? previous
            : { usage: usage ?? null, quota: quota ?? null },
        )
      } catch {
        // Reporting is optional. A browser that refuses just leaves the
        // tooltip without a size — not worth surfacing as an error.
      }
    }

    void measure()
    const timer = setInterval(() => void measure(), REFRESH_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return estimate
}
