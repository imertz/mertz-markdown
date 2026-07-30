import type { JSONContent } from '@tiptap/core'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
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

describe('markdown editor document loads', () => {
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
