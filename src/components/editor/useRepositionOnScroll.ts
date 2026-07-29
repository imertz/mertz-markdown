import type { Editor } from '@tiptap/core'
import type { PluginKey } from '@tiptap/pm/state'
import { useEffect } from 'react'

/**
 * Keep a bubble menu pinned to its anchor while the workspace scrolls.
 *
 * BubbleMenu positions itself `fixed` and repositions on `scroll` from
 * `options.scrollTarget`, which defaults to `window` — and a scroll event on a
 * div never reaches window. This app scrolls `.workspace`, not the page, so
 * out of the box the bar hangs where its anchor used to be.
 *
 * Setting `scrollTarget` looks like the fix and is not: the React wrapper
 * skips the first options update after the plugin initializes, and the change
 * from the placeholder `window` to the real element — which cannot be resolved
 * during render, because EditorContent attaches the editor DOM in its own
 * effect — is exactly that first update. So it is silently dropped.
 *
 * The plugin's documented escape hatch is used instead: a `'updatePosition'`
 * meta on its own plugin key. One rAF-throttled nudge per scroll frame, and
 * only while the menu is actually on screen.
 */
export function useRepositionOnScroll(
  editor: Editor,
  pluginKey: PluginKey,
  menuSelector: string,
): void {
  useEffect(() => {
    if (editor.isDestroyed) return

    const scroller = editor.view.dom.closest('.workspace')
    if (!scroller) return

    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (editor.isDestroyed) return
        // Nothing to move, so nothing to pay for on a normal scroll.
        if (!document.querySelector(menuSelector)) return
        editor.view.dispatch(
          editor.state.tr.setMeta(pluginKey, 'updatePosition'),
        )
      })
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [editor, pluginKey, menuSelector])
}
