import type { JSONContent } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useMarkdownEditor } from '../editor/useMarkdownEditor'

afterEach(cleanup)

const emptyParagraph = (): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph' }],
})

const emptyParagraphs = (): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph' }, { type: 'paragraph' }],
})

function EditorHarness({
  activeId,
  initialDoc,
  selectionPosition,
}: {
  activeId: string | null
  initialDoc: JSONContent | null
  selectionPosition?: number
}) {
  const editor = useMarkdownEditor({
    activeId,
    initialDoc,
  })

  useEffect(() => {
    if (!editor || selectionPosition === undefined) return
    editor.commands.setTextSelection(selectionPosition)
  }, [editor, selectionPosition])

  return <EditorContent editor={editor} />
}

describe('markdown editor document loads', () => {
  it('keeps the first paragraph marked empty after the stored document loads', async () => {
    const view = render(<EditorHarness activeId={null} initialDoc={null} />)

    await waitFor(() =>
      expect(view.container.querySelector('.ProseMirror')).not.toBeNull(),
    )

    view.rerender(
      <EditorHarness activeId="doc-1" initialDoc={emptyParagraph()} />,
    )

    await waitFor(() =>
      expect(
        view.container.querySelector('p')?.classList.contains('is-empty'),
      ).toBe(true),
    )
  })

  it('keeps the first paragraph marked empty when startup selection lands in a later empty block', async () => {
    const view = render(<EditorHarness activeId={null} initialDoc={null} />)

    await waitFor(() =>
      expect(view.container.querySelector('.ProseMirror')).not.toBeNull(),
    )

    view.rerender(
      <EditorHarness
        activeId="doc-1"
        initialDoc={emptyParagraphs()}
        selectionPosition={3}
      />,
    )

    await waitFor(() =>
      expect(
        view.container.querySelector('p')?.classList.contains('is-empty'),
      ).toBe(true),
    )
  })
})
