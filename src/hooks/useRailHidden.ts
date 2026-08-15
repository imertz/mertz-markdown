import { useCallback } from 'react'
import { usePersistedToggle } from './usePersistedToggle'

const RAIL_KEY = 'mertz-md:rail-hidden'

export interface RailVisibility {
  hidden: boolean
  toggle: () => void
  /** Force the rail back — the comment chips need it before they can jump. */
  show: () => void
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
  const { value: hidden, toggle, set } = usePersistedToggle(RAIL_KEY)
  const show = useCallback(() => set(false), [set])

  return { hidden, toggle, show }
}
