import type { Editor } from '@tiptap/core'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { TableControls } from '../components/editor/TableBubbleMenu'
import {
  shouldShowSelectionBar,
  shouldShowTableBar,
} from '../components/editor/bubbleVisibility'
import { toMarkdown } from '../markdown/export'
import { createTestEditor, rangeOfText } from './editorHarness'

afterEach(cleanup)

const TABLE = [
  '| Name | Count |',
  '| --- | --- |',
  '| alpha | 1 |',
  '| bravo | 2 |',
  '',
].join('\n')

const caretIn = (editor: Editor, needle: string) => {
  editor.commands.setTextSelection(rangeOfText(editor, needle).from)
}

const selectText = (editor: Editor, needle: string) => {
  editor.commands.setTextSelection(rangeOfText(editor, needle))
}

/** Select a run of cells, which is a CellSelection rather than a text range. */
const selectCells = (editor: Editor, from: string, to: string) => {
  editor.commands.setCellSelection({
    anchorCell: rangeOfText(editor, from).from - 2,
    headCell: rangeOfText(editor, to).from - 2,
  })
}

describe('the two bubble bars are mutually exclusive', () => {
  const situations = () => {
    const prose = createTestEditor('some ordinary prose here')
    const proseSelected = createTestEditor('some ordinary prose here')
    selectText(proseSelected, 'ordinary')

    const cellCaret = createTestEditor(TABLE)
    caretIn(cellCaret, 'alpha')

    const cellText = createTestEditor(TABLE)
    selectText(cellText, 'alpha')

    const cells = createTestEditor(TABLE)
    caretIn(cells, 'alpha')
    selectCells(cells, 'alpha', 'bravo')

    return { prose, proseSelected, cellCaret, cellText, cells }
  }

  it('never both, in any selection there is', () => {
    for (const editor of Object.values(situations())) {
      const both =
        shouldShowSelectionBar(editor.state, true) &&
        shouldShowTableBar(editor.state, true)
      expect(both).toBe(false)
    }
  })

  it('shows the table bar for a caret in a cell', () => {
    const { cellCaret } = situations()
    expect(shouldShowTableBar(cellCaret.state, true)).toBe(true)
    expect(shouldShowSelectionBar(cellCaret.state, true)).toBe(false)
  })

  it('shows the table bar for a selection of cells', () => {
    const { cells } = situations()
    expect(shouldShowTableBar(cells.state, true)).toBe(true)
    expect(shouldShowSelectionBar(cells.state, true)).toBe(false)
  })

  it('yields to the selection bar for text selected inside one cell', () => {
    // You selected text, not cells — so Comment and Link win. This falls
    // straight out of the rule rather than being special-cased.
    const { cellText } = situations()
    expect(shouldShowSelectionBar(cellText.state, true)).toBe(true)
    expect(shouldShowTableBar(cellText.state, true)).toBe(false)
  })

  it('shows the selection bar for text selected outside a table', () => {
    const { proseSelected } = situations()
    expect(shouldShowSelectionBar(proseSelected.state, true)).toBe(true)
    expect(shouldShowTableBar(proseSelected.state, true)).toBe(false)
  })

  it('shows neither for a bare caret in prose', () => {
    const { prose } = situations()
    expect(shouldShowSelectionBar(prose.state, true)).toBe(false)
    expect(shouldShowTableBar(prose.state, true)).toBe(false)
  })

  it('shows neither without focus', () => {
    // The check TipTap's default shouldShow made, which ours replaces.
    for (const editor of Object.values(situations())) {
      expect(shouldShowSelectionBar(editor.state, false)).toBe(false)
      expect(shouldShowTableBar(editor.state, false)).toBe(false)
    }
  })
})

/*
 * TableControls is rendered directly, never through BubbleMenu: the harness
 * editor mounts on a detached node and the menu appends itself to
 * `view.dom.parentElement`, so nothing rendered through it is reachable from
 * `screen` — and floating-ui would be measuring zeroes under happy-dom anyway.
 */
const setup = (markdown = TABLE, needle = 'alpha') => {
  const editor = createTestEditor(markdown)
  caretIn(editor, needle)
  render(<TableControls editor={editor} />)
  return { editor, user: userEvent.setup() }
}

const button = (name: string) =>
  screen.getByLabelText(name) as HTMLButtonElement

const delimiterRow = (markdown: string): string =>
  markdown
    .split('\n')
    .find(line => /^\|[\s:|-]+\|$/.test(line) && line.includes('-')) ?? ''

describe('TableControls', () => {
  it('adds a row', async () => {
    const { user, editor } = setup()

    await user.click(button('Add row below'))
    expect(toMarkdown(editor).trim().split('\n')).toHaveLength(5)
  })

  it('adds a column', async () => {
    const { user, editor } = setup()

    await user.click(button('Add column right'))
    expect(delimiterRow(toMarkdown(editor)).split('|')).toHaveLength(5)
  })

  it('aligns the whole column and marks the button pressed', async () => {
    const { user, editor } = setup()

    await user.click(button('Align column centre'))

    expect(delimiterRow(toMarkdown(editor))).toContain(':-')
    expect(button('Align column centre').getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('distinguishes left-aligned from unaligned', async () => {
    // They are pixel-identical in the document — `th { text-align: start }` —
    // but different bytes in the .md, so the control is the only way to tell.
    const { user, editor } = setup()
    expect(button('Align column left').getAttribute('aria-pressed')).toBe(
      'false',
    )

    await user.click(button('Align column left'))

    expect(button('Align column left').getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(delimiterRow(toMarkdown(editor))).toContain(':-')
  })

  it('clears alignment when the pressed button is clicked again', async () => {
    const { user, editor } = setup()
    const before = toMarkdown(editor)

    await user.click(button('Align column right'))
    expect(toMarkdown(editor)).not.toBe(before)

    await user.click(button('Align column right'))
    expect(toMarkdown(editor)).toBe(before)
  })

  it('disables deleting the only column', () => {
    setup('| Only |\n| --- |\n| one |\n', 'one')
    expect(button('Delete column').disabled).toBe(true)
    expect(button('Add column right').disabled).toBe(false)
  })

  it('toggles the header row', async () => {
    const { user, editor } = setup()
    expect(button('Header row').getAttribute('aria-pressed')).toBe('true')

    await user.click(button('Header row'))
    expect(button('Header row').getAttribute('aria-pressed')).toBe('false')
    expect(toMarkdown(editor)).toContain('| Name  | Count |')
  })

  it('takes two clicks to delete the table', async () => {
    const { user, editor } = setup()

    await user.click(button('Delete table'))
    // Nothing gone yet — the button has only changed what it says.
    expect(toMarkdown(editor)).toContain('alpha')
    expect(screen.getByText('Sure?')).toBeDefined()

    await user.click(button('Confirm deleting this table'))
    expect(toMarkdown(editor)).not.toContain('alpha')
  })
})
