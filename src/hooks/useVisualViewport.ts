import { useEffect } from 'react'

/**
 * Makes the shell track the *visual* viewport instead of the layout viewport.
 *
 * The problem this exists for is the phone keyboard. iOS shrinks the visual
 * viewport when the keyboard opens but leaves the layout viewport — and so
 * `svh` — untouched, then scrolls the layout viewport to chase the caret. A
 * shell sized to `100svh` is therefore taller than the screen, and the parts
 * pinned to its edges go with it: the header slides up under the status bar and
 * the Dynamic Island, and the status bar drops below the keyboard.
 *
 * Writing the measured height into `--app-height` makes the shell exactly as
 * tall as what is actually visible, which leaves nothing to scroll, which is
 * what stops the drift. The `scrollTo` is belt and braces for the frame before
 * the new height lands — the app itself never scrolls the window, so pinning it
 * to the top is always safe.
 *
 * `data-keyboard` is the CSS hook for anything that should get out of the way
 * while typing. The 120px threshold is well above any browser-chrome shuffle
 * and well below the smallest soft keyboard.
 */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement
    let frame = 0

    const apply = () => {
      frame = 0
      root.style.setProperty('--app-height', `${viewport.height}px`)
      if (viewport.height < window.innerHeight - 120) {
        root.dataset.keyboard = 'open'
      } else {
        delete root.dataset.keyboard
      }
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(apply)
    }

    apply()
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      root.style.removeProperty('--app-height')
      delete root.dataset.keyboard
    }
  }, [])
}
