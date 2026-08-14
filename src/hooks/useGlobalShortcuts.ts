import { useEffect, useRef } from 'react'
import type { Chord } from '../keys/chord'
import { matchesChord } from '../keys/chord'
import { firesIn, scopeOf } from '../keys/scope'

/**
 * A chord plus what to do about it.
 *
 * The chord itself — which key, which modifiers, and whether it matches by
 * character or by position — lives in `keys/chord`, so the same shape drives
 * the matcher and the cheat sheet without either of them restating it.
 */
export interface Shortcut extends Chord {
  /**
   * Whether this binding applies right now.
   *
   * Falling *through* to the next match rather than swallowing the key: a
   * table-only chord that is not in a table has to leave the keystroke for
   * whoever else wants it, including the browser.
   */
  when?: () => boolean
  run: () => void
}

/**
 * One window-level keydown listener for the whole app.
 *
 * A table rather than a chain of ifs because the modifiers have to be matched
 * *exactly*: ⌘K and ⌘⇧K are different commands, so a handler that only checks
 * for the modifiers it cares about would fire both. Every match calls
 * preventDefault, which is what lets ⌘F take over from the browser's own find.
 *
 * The list is read through a ref, so rebuilding it each render — which the
 * caller does, since the handlers close over state — never resubscribes.
 */
export function useGlobalShortcuts(shortcuts: readonly Shortcut[]): void {
  const current = useRef(shortcuts)
  useEffect(() => {
    current.current = shortcuts
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      /*
       * ProseMirror's own keymap sits on the editable node and runs first, so
       * a key it has already handled arrives here marked. Bailing makes the
       * editor authoritative over its own chords — ⌘B, Tab in a table — without
       * either side holding a list of the other's bindings.
       */
      if (event.defaultPrevented) return

      const scope = scopeOf(event)

      for (const shortcut of current.current) {
        if (!matchesChord(shortcut, event)) continue
        if (!firesIn(shortcut, scope)) continue
        if (shortcut.when && !shortcut.when()) continue

        event.preventDefault()
        shortcut.run()
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
