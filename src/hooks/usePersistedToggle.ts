import { useCallback, useState } from 'react'

/**
 * A boolean that survives a reload.
 *
 * Extracted when the library sidebar arrived and wanted exactly what the
 * comment rail already had. The try/catch is the whole reason this is worth
 * sharing: private-mode Safari *throws* on localStorage access rather than
 * returning null, and a standing view preference is never worth failing a
 * click — or a first paint — over.
 */

function stored(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

function persist(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // A preference that cannot be saved is not worth failing a click over.
  }
}

export interface PersistedToggle {
  value: boolean
  toggle: () => void
  /** Idempotent: writes nothing when already at the requested value. */
  set: (next: boolean) => void
}

export function usePersistedToggle(
  key: string,
  fallback = false,
): PersistedToggle {
  const [value, setValue] = useState(() => stored(key, fallback))

  const toggle = useCallback(() => {
    setValue(current => {
      persist(key, !current)
      return !current
    })
  }, [key])

  const set = useCallback(
    (next: boolean) => {
      setValue(current => {
        if (current === next) return current
        persist(key, next)
        return next
      })
    },
    [key],
  )

  return { value, toggle, set }
}
