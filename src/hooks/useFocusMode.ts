import { useCallback, useEffect, useState } from 'react'

const FOCUS_KEY = 'mertz-md:focus-mode'

export interface FocusMode {
  on: boolean
  toggle: () => void
}

function stored(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) === 'true'
  } catch {
    // Private-mode Safari throws on access rather than returning null.
    return false
  }
}

function persist(on: boolean): void {
  try {
    localStorage.setItem(FOCUS_KEY, String(on))
  } catch {
    // A preference that cannot be saved is not worth failing a keystroke over.
  }
}

/**
 * Whether everything but the block you are writing in is dimmed.
 *
 * A standing view preference, so it is persisted and shaped like the others —
 * see useRailHidden and useTheme. The attribute goes on the documentElement
 * the way the theme's does, because the rule that reads it has to sit above
 * .ProseMirror and there is no closer common ancestor the CSS can rely on.
 *
 * Deliberately not pre-paint like the theme: a wrongly-lit first frame is
 * invisible, where a wrongly-coloured one is a white flash.
 */
export function useFocusMode(): FocusMode {
  const [on, setOn] = useState(stored)

  useEffect(() => {
    if (on) document.documentElement.dataset.focusMode = 'on'
    else delete document.documentElement.dataset.focusMode
  }, [on])

  const toggle = useCallback(() => {
    setOn(current => {
      persist(!current)
      return !current
    })
  }, [])

  return { on, toggle }
}
