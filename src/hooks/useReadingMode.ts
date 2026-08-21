import { useCallback, useEffect, useState } from 'react'
import { scopeOf } from '../keys/scope'

export interface ReadingMode {
  on: boolean
  toggle: () => void
  exit: () => void
}

/**
 * Immersive reading: the chrome goes away and the document has the screen.
 *
 * The attribute rides on the documentElement the way the theme's and focus
 * mode's do — the rules that read it have to reach the header, the status bar
 * and the editor pane at once, and there is no closer common ancestor. The
 * panels are unmounted rather than hidden, which AppShell does by folding this
 * into their own visibility checks, so leaving the mode puts the library and
 * the rail back exactly as they were.
 *
 * NOT persisted, and that is the one place this deliberately parts company
 * with useFocusMode and useTheme beside it. Those change how the app looks;
 * this takes the app's controls off the screen, and a cold start into a page
 * with no header is a reader wondering what broke. It lasts as long as the
 * sitting that asked for it.
 */
export function useReadingMode(): ReadingMode {
  const [on, setOn] = useState(false)

  useEffect(() => {
    if (on) document.documentElement.dataset.readingMode = 'on'
    else delete document.documentElement.dataset.readingMode
  }, [on])

  const toggle = useCallback(() => setOn(current => !current), [])
  const exit = useCallback(() => setOn(false), [])

  /*
   * Escape leaves, which is the gesture a reader tries before looking for a
   * button. It cannot be an alias in the catalog: a bare key is inert inside
   * the editor by design — see `firesIn` — and the editor is what has focus
   * for the whole of a read.
   *
   * Bound only while the mode is on, and stood down for anything that owns the
   * screen: the palette and the find bar close on their own Escape, and this
   * firing too would close the reader out of the document behind them in the
   * same keystroke.
   */
  useEffect(() => {
    if (!on) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (scopeOf(event) === 'overlay') return
      setOn(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [on])

  return { on, toggle, exit }
}
