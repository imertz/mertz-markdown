import { useEffect, useRef, useState } from 'react'
import type { HeldModifiers } from './chord'
import { heldFrom } from './chord'
import { scopeOf } from './scope'

/**
 * Long enough that holding ⌘ on the way to ⌘S never flashes a panel, short
 * enough that hesitating for a beat is answered rather than ignored.
 */
export const PEEK_DELAY_MS = 400

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

const isEmpty = (held: HeldModifiers) => !held.mod && !held.alt && !held.shift

/**
 * The modifiers held long enough to be a question rather than a keystroke.
 *
 * Returns them once the reader has held a chord's worth of modifiers for
 * `PEEK_DELAY_MS` without pressing anything else, and keeps returning the live
 * set as they add or drop modifiers — so the panel re-filters immediately
 * rather than making them wait again. `null` the rest of the time.
 *
 * Nothing here dispatches. The panel this drives only ever lists chords whose
 * modifier set is exactly the one held, and the window matcher matches exactly
 * those modifiers — so "press the key to run it" is already true, and there is
 * no second code path that could disagree with the first.
 */
export function usePeek(enabled: boolean): HeldModifiers | null {
  const [held, setHeld] = useState<HeldModifiers | null>(null)
  const timer = useRef<number | null>(null)
  // Read inside the listeners, which are subscribed once.
  const live = useRef(enabled)
  live.current = enabled
  /*
   * The modifiers as of the most recent event, and whether the panel is up.
   *
   * Refs because the listeners subscribe once. `latest` in particular is what
   * the timer reads when it fires: reaching for ⌘⌥ presses ⌘ a moment before
   * ⌥, well inside the delay, and a panel that opened from the event that
   * armed it would answer a question the reader had already moved on from.
   */
  const latest = useRef<HeldModifiers>({ mod: false, alt: false, shift: false })
  const open = useRef(false)

  useEffect(() => {
    const cancel = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
    }

    const close = () => {
      cancel()
      open.current = false
      setHeld(null)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!MODIFIER_KEYS.has(event.key)) {
        // A real keystroke. Either the reader knew the chord all along, or they
        // have just run one off the panel; both end the peek.
        close()
        return
      }
      if (event.repeat) return

      const next = heldFrom(event)
      latest.current = next

      // Already up: follow the modifiers as they change, with no second wait.
      if (open.current) {
        setHeld(next)
        return
      }

      // Already counting: the timer will read the final set when it fires.
      if (timer.current !== null) return
      if (!live.current) return

      /*
       * Only with the primary modifier down. Shift alone is how a capital
       * letter is typed and Option alone is how macOS reaches a dead key, so
       * arming on either would put a panel over the document mid-word.
       */
      if (!next.mod) return

      /*
       * AltGr, which Windows reports as Ctrl+Alt. A German typist holding it to
       * reach `µ` is not asking what ⌘⌥ does.
       */
      if (
        typeof event.getModifierState === 'function' &&
        event.getModifierState('AltGraph')
      ) {
        return
      }

      // Not over a panel or a text field: those own their own keyboard, and
      // the commands listed here would not fire from inside them anyway.
      const scope = scopeOf(event)
      if (scope === 'overlay' || scope === 'field') return

      timer.current = window.setTimeout(() => {
        timer.current = null
        // `latest`, not the event that armed this: the reader may have added a
        // modifier since, and that is the question they are actually asking.
        if (isEmpty(latest.current)) return
        open.current = true
        setHeld(latest.current)
      }, PEEK_DELAY_MS)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (!MODIFIER_KEYS.has(event.key)) return
      const next = heldFrom(event)
      latest.current = next

      if (isEmpty(next)) {
        close()
        return
      }
      // Letting go of one of two modifiers is a narrowing, not a new question:
      // the panel follows, and a pending timer is abandoned rather than opening
      // onto a set the reader has already changed.
      cancel()
      if (open.current) setHeld(next)
    }

    /*
     * The stuck-modifier cases, and the reason this is not just keyup.
     *
     * ⌘Tab away and the `Meta` keyup lands in the other application, never
     * here — so without these the panel would sit on screen indefinitely, over
     * a document the reader has come back to. `blur` covers switching apps;
     * `visibilitychange` covers minimising and switching desktops.
     */
    const onLeave = () => close()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onLeave)
    // A modifier-click is a modifier-click, not a question about the keyboard.
    window.addEventListener('mousedown', onLeave)
    document.addEventListener('visibilitychange', onLeave)

    return () => {
      cancel()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onLeave)
      window.removeEventListener('mousedown', onLeave)
      document.removeEventListener('visibilitychange', onLeave)
    }
  }, [])

  // Closing an overlay must not leave a panel behind that was armed before it
  // opened.
  useEffect(() => {
    if (!enabled) setHeld(null)
  }, [enabled])

  return held
}
