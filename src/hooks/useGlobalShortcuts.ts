import { useEffect, useRef } from 'react'

export interface Shortcut {
  /**
   * `event.key`, lower-cased — so `'f'`, `'arrowup'`, `'escape'`.
   *
   * Deliberately `key` and not `code`: `code` is the physical key and would
   * send a Dvorak or AZERTY user's fingers somewhere else entirely. macOS does
   * not apply Option's character translation while Command is held, so
   * ⌘⌥M still arrives as `'m'` rather than `'µ'`.
   */
  key: string
  /** ⌘ on macOS, Ctrl everywhere else — the two are never distinguished. */
  mod?: boolean
  alt?: boolean
  shift?: boolean
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
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      for (const shortcut of current.current) {
        if (key !== shortcut.key) continue
        if (mod !== Boolean(shortcut.mod)) continue
        if (event.altKey !== Boolean(shortcut.alt)) continue
        if (event.shiftKey !== Boolean(shortcut.shift)) continue

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
