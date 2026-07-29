import type { Editor } from '@tiptap/core'
import type { BubbleMenuPluginProps } from '@tiptap/extension-bubble-menu'
import { findTable } from '@tiptap/pm/tables'
import { PluginKey } from '@tiptap/pm/state'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnAlign } from '../../editor/extensions/tableColumn'
import { readTableInfo } from '../../editor/extensions/tableColumn'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ColumnMinusIcon,
  ColumnPlusIcon,
  HeaderRowIcon,
  RowMinusIcon,
  RowPlusIcon,
  TrashIcon,
} from '../icons'
import { shouldShowTableBar } from './bubbleVisibility'
import { useRepositionOnScroll } from './useRepositionOnScroll'

type ShouldShow = NonNullable<BubbleMenuPluginProps['shouldShow']>

// Its own key: the selection bar keeps the default 'bubbleMenu'.
const TABLE_MENU_KEY = new PluginKey('tableBubbleMenu')

const ALIGNMENTS: { value: Exclude<ColumnAlign, null>; label: string; Icon: typeof AlignLeftIcon }[] =
  [
    { value: 'left', label: 'Align column left', Icon: AlignLeftIcon },
    { value: 'center', label: 'Align column centre', Icon: AlignCenterIcon },
    { value: 'right', label: 'Align column right', Icon: AlignRightIcon },
  ]

/**
 * Row, column and alignment controls, floating over the table the caret is in.
 *
 * Split in two on purpose. The React BubbleMenu dispatches a transaction
 * whenever `shouldShow`, `options` or `getReferencedVirtualElement` change
 * identity — so all three are memoized here, and `useEditorState` (which
 * re-renders on every transaction) lives in the child. Together in one
 * component they would feed each other.
 */
export function TableBubbleMenu({ editor }: { editor: Editor }) {
  const shouldShow = useCallback<ShouldShow>(
    ({ view, element, state }) =>
      shouldShowTableBar(
        state,
        view.hasFocus() || element.contains(document.activeElement),
      ),
    [],
  )

  /**
   * Anchored to the table, not to the caret: a bar that hopped from cell to
   * cell as you typed would be a distraction, and every operation on it is
   * table-scoped anyway. With `resizable: true` the table's nodeDOM is
   * TableView's `.tableWrapper` div.
   */
  const getReferencedVirtualElement = useCallback(() => {
    if (editor.isDestroyed) return null
    const found = findTable(editor.state.selection.$head)
    if (!found) return null

    const dom = editor.view.nodeDOM(found.pos)
    if (!(dom instanceof HTMLElement)) return null

    return {
      getBoundingClientRect: () => dom.getBoundingClientRect(),
      getClientRects: () => dom.getClientRects(),
    }
  }, [editor])

  // The plugin cannot see .workspace scrolling on its own; see the hook.
  useRepositionOnScroll(editor, TABLE_MENU_KEY, '.table-bar')

  const options = useMemo(
    () => ({
      placement: 'top-end' as const,
      // Fixed, not absolute: `.workspace` is `overflow-x: hidden` and would
      // clip an absolutely positioned child — the same reason .link-popover is
      // fixed. See the comment on it in editor.css.
      strategy: 'fixed' as const,
      offset: 8,
      // Fades the bar out once its table has scrolled off screen, rather than
      // leaving it pinned over unrelated text.
      hide: true,
    }),
    [],
  )

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={TABLE_MENU_KEY}
      className="table-bar"
      role="toolbar"
      aria-label="Table"
      // The 250ms default applies to non-empty selections, i.e. dragging
      // across cells — exactly when the bar should keep up.
      updateDelay={0}
      shouldShow={shouldShow}
      getReferencedVirtualElement={getReferencedVirtualElement}
      options={options}
    >
      <TableControls editor={editor} />
    </BubbleMenu>
  )
}

/**
 * The button row. Exported so tests can render it directly — the real
 * BubbleMenu appends itself to `view.dom.parentElement`, which for a detached
 * test editor is unreachable from `screen`.
 */
export function TableControls({ editor }: { editor: Editor }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const info = readTableInfo(instance.state)
      return {
        canAddRow: instance.can().addRowAfter(),
        canAddColumn: instance.can().addColumnAfter(),
        // NOT can().deleteRow() — upstream's "would empty the table" guard
        // sits inside `if (dispatch)`, so can() answers true right up until it
        // wipes the table. readTableInfo mirrors the guard.
        canDeleteRow: info?.canDeleteRow ?? false,
        canDeleteColumn: info?.canDeleteColumn ?? false,
        headerRow: info?.headerRow ?? false,
        align: info?.columnAlign ?? null,
      }
    },
  })

  // A half-armed delete must not survive the caret moving to another table.
  useEffect(() => {
    setConfirmingDelete(false)
  }, [state])

  // `.focus()` is not decoration: clicking a button moves focus into the bar,
  // and every one of these commands reads the cell the caret is in.
  const run = (action: (chain: ReturnType<Editor['chain']>) => unknown) => {
    action(editor.chain().focus())
  }

  return (
    <>
      <button
        type="button"
        aria-label="Add row below"
        title="Add row below"
        disabled={!state.canAddRow}
        onClick={() => run(chain => chain.addRowAfter().run())}
      >
        <RowPlusIcon />
      </button>
      <button
        type="button"
        aria-label="Delete row"
        title="Delete row"
        disabled={!state.canDeleteRow}
        onClick={() => run(chain => chain.deleteRow().run())}
      >
        <RowMinusIcon />
      </button>

      <div className="table-bar__sep" />

      <button
        type="button"
        aria-label="Add column right"
        title="Add column right"
        disabled={!state.canAddColumn}
        onClick={() => run(chain => chain.addColumnAfter().run())}
      >
        <ColumnPlusIcon />
      </button>
      <button
        type="button"
        aria-label="Delete column"
        title="Delete column"
        disabled={!state.canDeleteColumn}
        onClick={() => run(chain => chain.deleteColumn().run())}
      >
        <ColumnMinusIcon />
      </button>

      <div className="table-bar__sep" />

      {ALIGNMENTS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          title={`${label}. GFM stores this per column, so the whole column moves.`}
          aria-pressed={state.align === value}
          // Clicking the pressed one clears it. Left-aligned and unaligned
          // look identical on screen but are different bytes in the .md, so
          // this is the only route back to an unaligned column.
          onClick={() =>
            run(chain =>
              chain
                .setColumnAlignment(state.align === value ? null : value)
                .run(),
            )
          }
        >
          <Icon />
        </button>
      ))}

      <div className="table-bar__sep" />

      <button
        type="button"
        aria-label="Header row"
        title="Header row"
        aria-pressed={state.headerRow}
        onClick={() => run(chain => chain.toggleHeaderRow().run())}
      >
        <HeaderRowIcon />
      </button>

      <div className="table-bar__sep" />

      {/*
        Two clicks, no dialog. Undo would bring the table back, but the bar
        goes with it — there is no affordance left on screen to say so.
      */}
      <button
        type="button"
        className="table-bar__danger"
        aria-label={
          confirmingDelete ? 'Confirm deleting this table' : 'Delete table'
        }
        title="Delete table"
        onClick={() => {
          if (!confirmingDelete) {
            setConfirmingDelete(true)
            return
          }
          setConfirmingDelete(false)
          run(chain => chain.deleteTable().run())
        }}
      >
        {confirmingDelete ? 'Sure?' : <TrashIcon />}
      </button>
    </>
  )
}
