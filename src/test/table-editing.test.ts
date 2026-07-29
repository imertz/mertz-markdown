import type { Editor, JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { readTableInfo } from '../editor/extensions/tableColumn'
import { toMarkdown } from '../markdown/export'
import {
  createTestEditor,
  createTestEditorFromJSON,
  rangeOfText,
} from './editorHarness'

const TABLE = [
  '| Name | Count |',
  '| --- | --- |',
  '| alpha | 1 |',
  '| bravo | 2 |',
  '',
].join('\n')

/**
 * The same table as the serializer writes it: columns padded to their widest
 * cell, and a leading newline from `renderTableToMarkdown`. Comparisons are
 * against this rather than the source, because the normalization is upstream
 * behaviour and not what these tests are about.
 */
const CANONICAL = toMarkdown(createTestEditor(TABLE))

/** Put the caret inside the cell containing `needle`. */
const caretIn = (editor: Editor, needle: string) => {
  editor.commands.setTextSelection(rangeOfText(editor, needle).from)
}

/** The `| --- | :---: |` line, which is where GFM keeps alignment. */
const delimiterRow = (markdown: string): string =>
  markdown
    .split('\n')
    .find(line => /^\|[\s:|-]+\|$/.test(line) && line.includes('-')) ?? ''

const countType = (editor: Editor, type: string): number => {
  let found = 0
  editor.state.doc.descendants(node => {
    if (node.type.name === type) found += 1
  })
  return found
}

describe('table cells hold a single line', () => {
  it('declares one paragraph per cell in the schema', () => {
    const editor = createTestEditor(TABLE)
    expect(editor.schema.nodes.tableCell.spec.content).toBe('paragraph')
    expect(editor.schema.nodes.tableHeader.spec.content).toBe('paragraph')
  })

  it('does not split a cell when Enter is pressed', () => {
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')
    const before = editor.state.doc.toJSON()

    editor.commands.keyboardShortcut('Enter')

    expect(editor.state.doc.toJSON()).toEqual(before)
    expect(toMarkdown(editor)).toBe(CANONICAL)
  })

  it('leaves Enter alone outside a table', () => {
    // The guard is scoped to tables; ordinary prose must still split.
    const editor = createTestEditor('one paragraph')
    caretIn(editor, 'paragraph')
    editor.commands.keyboardShortcut('Enter')

    expect(countType(editor, 'paragraph')).toBeGreaterThan(1)
  })

  it('inserts no hard break on Shift-Enter inside a cell', () => {
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')

    editor.commands.keyboardShortcut('Shift-Enter')

    expect(countType(editor, 'hardBreak')).toBe(0)
    expect(toMarkdown(editor)).not.toMatch(/<[a-z][^>]*>/i)
  })

  it('turns a pasted hard break into a space', () => {
    // The layer the keymap cannot reach: paste, drop and setContent.
    const editor = createTestEditor(TABLE)
    const { to } = rangeOfText(editor, 'alpha')
    editor.commands.insertContentAt(to, { type: 'hardBreak' })

    expect(countType(editor, 'hardBreak')).toBe(0)
    expect(toMarkdown(editor)).not.toMatch(/<[a-z][^>]*>/i)
  })

  it('flattens a cell stored before the constraint existed', () => {
    // Node.fromJSON does not check content expressions unless
    // enableContentCheck is on, and it is off — so a document saved by an
    // older build loads with two paragraphs in a cell and would otherwise
    // serialize them joined by a literal <br>.
    const legacy: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Head' }] },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    const markdown = toMarkdown(createTestEditorFromJSON(legacy))

    expect(markdown).not.toMatch(/<[a-z][^>]*>/i)
    expect(markdown).toContain('first second')
  })
})

describe('KNOWN LIMITATION: a pipe typed into a cell is not escaped', () => {
  /**
   * `renderTableToMarkdown` writes cell content verbatim between its own
   * pipes and has no escaping on the render side — `preprocessTablePipes` is
   * import-only. Nor can it be fixed from the document: a `\` placed in the
   * text is itself escaped to `\\` on the way out, so no doc-level string
   * serializes as `\|`. Fixing it means replacing the upstream table
   * serializer.
   *
   * Pinned rather than left undiscovered: if a TipTap upgrade fixes this,
   * these tests fail and the limitation comes out of README.md.
   */
  it('splits the cell it was typed into', () => {
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')
    editor.commands.insertContent(' | tail')

    const markdown = toMarkdown(editor)
    // Three columns' worth of pipes on a two-column row.
    const row = markdown.split('\n').find(line => line.includes('tail')) ?? ''
    expect(row.split('|')).toHaveLength(5)
  })

  it('at least keeps the text visible rather than dropping it', () => {
    // The damage is structural, not a silent deletion — everything the user
    // typed is still in the file, just in the wrong cell.
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')
    editor.commands.insertContent(' | tail')

    expect(toMarkdown(editor)).toContain('tail')
  })
})

describe('column alignment', () => {
  it('writes every cell in the column, header included', () => {
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')

    editor.commands.setColumnAlignment('center')

    const aligned: unknown[] = []
    editor.state.doc.descendants(node => {
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        aligned.push(node.attrs.align)
      }
    })
    // Six cells, three in the first column — the header among them, because
    // the serializer scans a column from the top.
    expect(aligned.filter(value => value === 'center')).toHaveLength(3)
    expect(delimiterRow(toMarkdown(editor))).toBe('| :-----: | ----- |')
  })

  it('is a single undo step', () => {
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')

    editor.commands.setColumnAlignment('right')
    // Prove it did something, or the undo assertion passes vacuously.
    expect(toMarkdown(editor)).not.toBe(CANONICAL)

    editor.commands.undo()
    expect(toMarkdown(editor)).toBe(CANONICAL)
  })

  it('clears back to an unaligned column with null', () => {
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')

    editor.commands.setColumnAlignment('left')
    expect(delimiterRow(toMarkdown(editor))).toContain(':--')

    editor.commands.setColumnAlignment(null)
    expect(toMarkdown(editor)).toBe(CANONICAL)
  })

  it('round-trips every alignment through markdown', () => {
    const source = [
      '| L | C | R |',
      '| :--- | :---: | ---: |',
      '| a | b | c |',
      '',
    ].join('\n')

    const editor = createTestEditor(source)
    caretIn(editor, 'a')
    expect(readTableInfo(editor.state)?.columnAlign).toBe('left')

    const once = toMarkdown(editor)
    expect(delimiterRow(once)).toBe('| :--- | :---: | ---: |')
    expect(toMarkdown(createTestEditor(once))).toBe(once)
  })

  it('does nothing outside a table', () => {
    const editor = createTestEditor('just a paragraph')
    expect(editor.commands.setColumnAlignment('center')).toBe(false)
  })
})

describe('readTableInfo', () => {
  it('reports null when the caret is not in a table', () => {
    const editor = createTestEditor('prose')
    expect(readTableInfo(editor.state)).toBeNull()
  })

  it('refuses to delete the last column, where can() would not', () => {
    const editor = createTestEditor('| Only |\n| --- |\n| one |\n')
    caretIn(editor, 'one')

    expect(readTableInfo(editor.state)?.canDeleteColumn).toBe(false)
    // The reason this helper exists: upstream's guard sits inside
    // `if (dispatch)`, so can() cannot see it.
    expect(editor.can().deleteColumn()).toBe(true)
  })

  it('allows deleting a column when others remain', () => {
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')
    expect(readTableInfo(editor.state)?.canDeleteColumn).toBe(true)
  })

  it('tracks whether the first row is a header', () => {
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')
    expect(readTableInfo(editor.state)?.headerRow).toBe(true)

    editor.commands.toggleHeaderRow()
    expect(readTableInfo(editor.state)?.headerRow).toBe(false)
  })
})

describe('table structure edits', () => {
  it('adds a row and takes it away again', () => {
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')

    editor.commands.addRowAfter()
    expect(toMarkdown(editor).trim().split('\n')).toHaveLength(5)

    // Undo rather than deleteRow: the caret is still in alpha's row, so
    // deleting would take that one rather than the row just added.
    editor.commands.undo()
    expect(toMarkdown(editor)).toBe(CANONICAL)
  })

  it('deletes the row the caret is in', () => {
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')

    editor.commands.deleteRow()

    const markdown = toMarkdown(editor)
    expect(markdown).not.toContain('alpha')
    expect(markdown).toContain('bravo')
  })

  it('adds and deletes columns', () => {
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')

    editor.commands.addColumnAfter()
    expect(delimiterRow(toMarkdown(editor)).split('|')).toHaveLength(5)

    editor.commands.deleteColumn()
    // The caret is still in the Name column, so this deletes that one.
    expect(toMarkdown(editor)).not.toContain('alpha')
    expect(toMarkdown(editor)).toContain('Count')
  })

  it('keeps a headerless table idempotent through markdown', () => {
    // GFM requires a header, so turning it off serializes an empty header row
    // and reads back with one. Lossy but stable — this locks that in rather
    // than leaving it to be discovered.
    const editor = createTestEditor(TABLE)
    caretIn(editor, 'alpha')
    editor.commands.toggleHeaderRow()

    const once = toMarkdown(editor)
    expect(once).not.toMatch(/<[a-z][^>]*>/i)
    expect(once).toContain('| Name  | Count |')
    expect(toMarkdown(createTestEditor(once))).toBe(once)
  })
})
