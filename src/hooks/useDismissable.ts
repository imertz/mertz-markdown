import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'

/**
 * Close-on-outside-click and close-on-Escape for a popover.
 *
 * Returns the ref to put on the element that counts as "inside" — both the
 * trigger and the panel, so clicking the trigger to close does not fight the
 * outside handler.
 *
 * The callback is read through a ref so a fresh closure each render does not
 * resubscribe the document listeners, matching how `useMarkdownEditor` holds
 * its handlers.
 */
export function useDismissable<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
  onDismiss: () => void,
): RefObject<T | null> {
  const container = useRef<T>(null)
  const dismiss = useRef(onDismiss)

  useEffect(() => {
    dismiss.current = onDismiss
  })

  useEffect(() => {
    if (!active) return

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) dismiss.current()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss.current()
    }

    /* pointerdown, not mousedown: it covers touch and pen as well as the mouse.
       iOS synthesises a mouse event on tap, so the old listener mostly worked,
       but not for a tap that turns into a scroll. */
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [active])

  return container
}
