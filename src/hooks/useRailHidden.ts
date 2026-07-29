import { useCallback, useState } from 'react'

const RAIL_KEY = 'mertz-md:rail-hidden'

export interface RailVisibility {
  hidden: boolean
  toggle: () => void
  /** Force the rail back — the comment chips need it before they can jump. */
  show: () => void
}

function stored(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === 'true'
  } catch {
    // Private-mode Safari throws on access rather than returning null.
    return false
  }
}

function persist(hidden: boolean): void {
  try {
    localStorage.setItem(RAIL_KEY, String(hidden))
  } catch {
    // A preference that cannot be saved is not worth failing a click over.
  }
}

/**
 * Whether the comment rail is collapsed, remembered across reloads.
 *
 * Persisted like the theme (`useTheme`) because it is the same kind of thing: a
 * standing view preference, not per-document state. Hiding the rail never
 * touches the comment marks — they live in the document and the panel is only
 * a view of them.
 */
export function useRailHidden(): RailVisibility {
  const [hidden, setHidden] = useState(stored)

  const toggle = useCallback(() => {
    setHidden(current => {
      persist(!current)
      return !current
    })
  }, [])

  const show = useCallback(() => {
    setHidden(current => {
      if (!current) return current
      persist(false)
      return false
    })
  }, [])

  return { hidden, toggle, show }
}
