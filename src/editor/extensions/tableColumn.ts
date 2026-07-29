import { Extension } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { isInTable, selectedRect } from '@tiptap/pm/tables'

/** What GFM's delimiter row can express. `null` is an unaligned column. */
export type ColumnAlign = 'left' | 'center' | 'right' | null

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableColumn: {
      /** Align every cell in the selected column(s). `null` clears. */
      setColumnAlignment: (align: ColumnAlign) => ReturnType
    }
  }
}

const alignOf = (attrs: Record<string, unknown> | undefined): ColumnAlign => {
  const value = attrs?.align
  return value === 'left' || value === 'center' || value === 'right'
    ? value
    : null
}

export interface TableInfo {
  /**
   * Whether deleting is allowed. NOT `editor.can().deleteRow()` — upstream puts
   * the "would empty the table" guard *inside* `if (dispatch)`, and `can()`
   * calls with no dispatch, so it answers true right up until it wipes the
   * table. This mirrors the guard where it can actually be read.
   */
  canDeleteRow: boolean
  canDeleteColumn: boolean
  headerRow: boolean
  /** The alignment the exported delimiter row will carry for this column. */
  columnAlign: ColumnAlign
}

/**
 * The table state the UI needs, or null when the caret is not in a table.
 *
 * The null guard is load-bearing: `selectedRect` throws outside a table.
 */
export function readTableInfo(state: EditorState): TableInfo | null {
  if (!isInTable(state)) return null

  const rect = selectedRect(state)
  const { map, tableStart } = rect
  const cellAt = (row: number, column: number) =>
    state.doc.nodeAt(tableStart + map.map[row * map.width + column])

  let headerRow = map.width > 0
  for (let column = 0; column < map.width; column += 1) {
    if (cellAt(0, column)?.type.spec.tableRole !== 'header_cell') {
      headerRow = false
      break
    }
  }

  // Mirrors the serializer, which takes one alignment per column: the first
  // non-null it finds scanning top-down. Reading the caret's own cell instead
  // would let the control disagree with the file for an imported table whose
  // column has mixed values.
  let columnAlign: ColumnAlign = null
  for (let row = 0; row < map.height; row += 1) {
    const align = alignOf(cellAt(row, rect.left)?.attrs)
    if (align) {
      columnAlign = align
      break
    }
  }

  return {
    canDeleteRow: !(rect.top === 0 && rect.bottom === map.height),
    canDeleteColumn: !(rect.left === 0 && rect.right === map.width),
    headerRow,
    columnAlign,
  }
}

/**
 * Column alignment.
 *
 * GFM stores alignment once per column, in the delimiter row, and the
 * serializer reads it as the first non-null value scanning a column top-down.
 * A per-cell control would therefore write `| :--- |` under a column where
 * only one cell looked aligned. Writing the whole column keeps the screen and
 * the file in agreement by construction.
 */
export const TableColumn = Extension.create({
  name: 'tableColumn',

  addCommands() {
    return {
      setColumnAlignment:
        (align: ColumnAlign) =>
        ({ state, tr, dispatch }) => {
          if (!isInTable(state)) return false
          if (!dispatch) return true

          const rect = selectedRect(state)
          // Rows 0..height, so the header is aligned too — the serializer
          // scans from the top, and a header left unaligned above an aligned
          // body would be the value it picked up.
          const cells = rect.map.cellsInRect({
            left: rect.left,
            right: rect.right,
            top: 0,
            bottom: rect.map.height,
          })

          // One transaction, so one undo step. An attribute-only markup change
          // replaces a node with one of identical size, so nothing moves and
          // no position needs mapping.
          for (const cell of cells) {
            tr.setNodeAttribute(rect.tableStart + cell, 'align', align)
          }

          dispatch(tr)
          return true
        },
    }
  },
})
