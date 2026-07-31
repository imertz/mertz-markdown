import type { JSONContent } from '@tiptap/core'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDocument } from '../db/documents'
import { useDocuments } from '../hooks/useDocuments'
import { APP_NAME, deriveTitle, pageTitle, UNTITLED } from '../lib/title'
import { resetDatabase } from './dbHarness'

/**
 * A title normally follows the content — `deriveTitle` re-runs on every save.
 * Renaming pins it against that, and clearing the name is the only way back.
 */

beforeEach(resetDatabase)

const docWithHeading = (text: string): JSONContent => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] },
  ],
})

/** A hook with one document open, ready to be saved into. */
const openDocuments = async () => {
  const view = renderHook(() => useDocuments())
  await waitFor(() => {
    expect(view.result.current.status).not.toBe('loading')
  })

  await act(async () => {
    await view.result.current.create()
  })
  await waitFor(() => {
    expect(view.result.current.activeId).not.toBeNull()
  })

  const id = view.result.current.activeId
  if (id === null) throw new Error('no document was created')
  return { view, id }
}

describe('document titles', () => {
  it('does not use a slash-command trigger as the title', () => {
    expect(
      deriveTitle({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '/heading' }],
          },
        ],
      }),
    ).toBe(UNTITLED)
  })

  it('follows the content while the document has no name of its own', async () => {
    const { view, id } = await openDocuments()

    await act(async () => {
      await view.result.current.save(id, docWithHeading('Derived heading'), '')
    })

    expect(view.result.current.activeTitle).toBe('Derived heading')
  })

  it('keeps a typed name through later saves', async () => {
    const { view, id } = await openDocuments()

    await act(async () => {
      await view.result.current.rename(id, 'Release notes')
    })
    expect(view.result.current.activeTitle).toBe('Release notes')

    // The save that would otherwise re-derive from this heading.
    await act(async () => {
      await view.result.current.save(id, docWithHeading('Derived heading'), '')
    })

    expect(view.result.current.activeTitle).toBe('Release notes')
    expect((await getDocument(id))?.titleOverride).toBe('Release notes')
  })

  it('trims the name, since the list has no room for the difference', async () => {
    const { view, id } = await openDocuments()

    await act(async () => {
      await view.result.current.rename(id, '  Release notes  ')
    })

    expect(view.result.current.activeTitle).toBe('Release notes')
  })

  it('hands the title back to the content when the name is cleared', async () => {
    const { view, id } = await openDocuments()

    await act(async () => {
      await view.result.current.save(id, docWithHeading('Derived heading'), '')
      await view.result.current.rename(id, 'Release notes')
    })
    expect(view.result.current.activeTitle).toBe('Release notes')

    await act(async () => {
      await view.result.current.rename(id, '   ')
    })

    // Recomputed on the spot rather than waiting for the next autosave, or the
    // document would go on wearing the name just dropped.
    expect(view.result.current.activeTitle).toBe('Derived heading')
    expect((await getDocument(id))?.titleOverride).toBeNull()
  })

  it('does not reorder the list, which is sorted by when the content changed', async () => {
    const { view, id } = await openDocuments()
    const before = view.result.current.documents.find(
      record => record.id === id,
    )?.updatedAt

    await act(async () => {
      await view.result.current.rename(id, 'Release notes')
    })

    expect(
      view.result.current.documents.find(record => record.id === id)?.updatedAt,
    ).toBe(before)
  })
})

describe('browser page titles', () => {
  it('combines a document title with the app name', () => {
    expect(pageTitle('Release notes')).toBe(
      `Release notes | ${APP_NAME}`,
    )
  })

  it('uses only the app name when the document is untitled', () => {
    expect(pageTitle('Untitled document')).toBe(APP_NAME)
    expect(pageTitle('')).toBe(APP_NAME)
  })

  it('trims whitespace before building the page title', () => {
    expect(pageTitle('  Release notes  ')).toBe(
      `Release notes | ${APP_NAME}`,
    )
  })
})
