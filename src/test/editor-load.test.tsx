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

    view.unmount()
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

  /**
   * The hook deliberately does not preserve an unflushed buffer — it has no way
   * to know one exists. Committing it is the caller's job, which AppShell does
   * by flushing inside its remote-change callback; `sync-remote-reload*.test`
   * covers that. This case pins down the hook half of the contract so a change
   * to the reload path cannot quietly move the responsibility.
   */
  it('replaces the buffer on reload without emitting an update', async () => {
    const onDocChanged = vi.fn()
    const onDocumentLoaded = vi.fn()
    const first = paragraph('Draft')
    const remote = paragraph('Remote version')

    const view = renderHook(
      ({ initialDoc, reloadToken }) =>
        useMarkdownEditor({
          activeId: 'doc-1',
          initialDoc,
          reloadToken,
          onDocChanged,
          onDocumentLoaded,
        }),
      { initialProps: { initialDoc: first, reloadToken: 0 } },
    )

    await waitFor(() => expect(onDocumentLoaded).toHaveBeenCalledTimes(1))

    const editor = view.result.current
    expect(editor?.getText()).toBe('Draft')

    // The user keeps typing; the debounced autosave has not flushed yet. The
    // caret is placed explicitly rather than left wherever the editor opened
    // it — this test is about what happens to the buffer, and it should not
    // start failing because the editor's resting caret position moved.
    editor?.commands.focus('end')
    editor?.commands.insertContent(' + unsaved keystrokes')
    expect(editor?.getText()).toBe('Draft + unsaved keystrokes')
    const updatesBeforeReload = onDocChanged.mock.calls.length

    // A remote pull replaces the document in storage and advances the token.
    view.rerender({ initialDoc: remote, reloadToken: 1 })

    await waitFor(() => expect(onDocumentLoaded).toHaveBeenCalledTimes(2))
    expect(editor?.getText()).toBe('Remote version')

    // emitUpdate:false, so the reload itself schedules no save. Whatever was in
    // the buffer has to have been committed before this point.
    expect(onDocChanged.mock.calls.length).toBe(updatesBeforeReload)
    expect(editor?.getText()).not.toContain('unsaved keystrokes')

    view.unmount()
  })
})
