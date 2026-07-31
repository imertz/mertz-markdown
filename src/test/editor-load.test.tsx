import type { JSONContent } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMarkdownEditor } from '../editor/useMarkdownEditor'

afterEach(cleanup)

const paragraph = (text: string): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text }],
    },
  ],
})

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
  it('keeps the empty-document placeholder after the stored document loads', async () => {
    const view = render(<EditorHarness activeId={null} initialDoc={null} />)

    await waitFor(() =>
      expect(view.container.querySelector('.ProseMirror')).not.toBeNull(),
    )

    view.rerender(
      <EditorHarness activeId="doc-1" initialDoc={emptyParagraph()} />,
    )

    await waitFor(() =>
      expect(
        view.container.querySelector('p')?.getAttribute('data-placeholder'),
      ).toBe('Start writing…'),
    )

    view.unmount()
  })

  it('keeps the prompt visible when startup selection lands in a later empty block', async () => {
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
        view.container.querySelector('p')?.getAttribute('data-placeholder'),
      ).toBe('Start writing…'),
    )

    view.unmount()
  })

  it('reports a same-document reload after vault sync advances the token', async () => {
    const onDocumentLoaded = vi.fn()
    const first = paragraph('Local version')
    const remote = paragraph('Remote version')

    const view = renderHook(
      ({ initialDoc, reloadToken }) =>
        useMarkdownEditor({
          activeId: 'doc-1',
          initialDoc,
          reloadToken,
          onDocumentLoaded,
        }),
      { initialProps: { initialDoc: first, reloadToken: 0 } },
    )

    await waitFor(() => expect(onDocumentLoaded).toHaveBeenCalledTimes(1))
    expect(view.result.current?.getText()).toBe('Local version')

    view.rerender({ initialDoc: remote, reloadToken: 1 })

    await waitFor(() => expect(onDocumentLoaded).toHaveBeenCalledTimes(2))
    expect(view.result.current?.getText()).toBe('Remote version')
    expect(onDocumentLoaded).toHaveBeenLastCalledWith('doc-1')
  })
})
