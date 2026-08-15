import { useCallback } from 'react'
import { usePersistedToggle } from './usePersistedToggle'

const LIBRARY_KEY = 'mertz-md:library-hidden'

export interface LibraryVisibility {
  hidden: boolean
  toggle: () => void
  /** Used by the drawer, which closes itself once a document has been opened. */
  hide: () => void
}

/**
 * Whether the library sidebar is collapsed, remembered across reloads.
 *
 * The mirror of `useRailHidden` on the other side of the workspace, down to
 * sharing its storage primitive. It starts **hidden**, unlike the rail: the
 * comments belong to the document you are reading, whereas the library is how
 * you got to it and has done its job by the time you are typing.
 */
export function useLibraryHidden(): LibraryVisibility {
  const { value: hidden, toggle, set } = usePersistedToggle(LIBRARY_KEY, true)
  const hide = useCallback(() => set(true), [set])

  return { hidden, toggle, hide }
}
