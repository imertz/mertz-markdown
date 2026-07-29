import type { Editor } from '@tiptap/core'
import type { BubbleMenuPluginProps } from '@tiptap/extension-bubble-menu'
import { PluginKey } from '@tiptap/pm/state'
import { BubbleMenu } from '@tiptap/react/menus'
import { useCallback } from 'react'
import { formatShortcut } from '../../lib/shortcuts'
import { CommentIcon, LinkIcon } from '../icons'
import { shouldShowSelectionBar } from './bubbleVisibility'
import { useRepositionOnScroll } from './useRepositionOnScroll'

type ShouldShow = NonNullable<BubbleMenuPluginProps['shouldShow']>

// Named explicitly so the reposition hook has something to address.
const SELECTION_MENU_KEY = new PluginKey('selectionBubbleMenu')

interface SelectionBubbleMenuProps {
  editor: Editor
  onAddComment: () => void
  onAddLink: () => void
}

/**
 * The two things you can do to a span of text that no toolbar button can do,
 * because both need to know *which* span: annotate it, or point it somewhere.
 */
export function SelectionBubbleMenu({
  editor,
  onAddComment,
  onAddLink,
}: SelectionBubbleMenuProps) {
  // Stable identity: the React wrapper dispatches a transaction every time this
  // prop changes, so an inline arrow costs one spurious transaction per render.
  const shouldShow = useCallback<ShouldShow>(
    ({ view, element, state }) =>
      shouldShowSelectionBar(
        state,
        view.hasFocus() || element.contains(document.activeElement),
      ),
    [],
  )

  // Without this the bar is stranded where the selection used to be as soon as
  // the workspace scrolls; see the hook.
  useRepositionOnScroll(editor, SELECTION_MENU_KEY, '.bubble-menu')

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={SELECTION_MENU_KEY}
      className="bubble-menu"
      shouldShow={shouldShow}
    >
      {/* Shortcuts mirror the handlers in AppShell. */}
      <button
        type="button"
        title={`Comment (${formatShortcut('mod+alt+m')})`}
        onClick={onAddComment}
      >
        <CommentIcon width={14} height={14} />
        Comment
      </button>

      <button
        type="button"
        title={`Link (${formatShortcut('mod+shift+k')})`}
        onClick={onAddLink}
      >
        <LinkIcon width={14} height={14} />
        Link
      </button>
    </BubbleMenu>
  )
}
