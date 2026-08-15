import type { JSONContent } from '@tiptap/core'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDocument } from '../db/documents'
import { useDocuments } from '../hooks/useDocuments'
import { resetDatabase } from './dbHarness'

/**
 * Filing through the hook the app actually calls.
 *
 * The database tests cover what each writer does; this covers the two things
 * only the hook can get wrong — an autosave quietly dropping the filing, and
 * the list reordering under the user because of it.
 */

beforeEach(resetDatabase)

const body = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const openDocuments = async () => {
  const view = renderHook(() => useDocuments())
  await waitFor(() => {
    expect(view.result.current.status).not.toBe('loading')
  })
  return view
}

/** One document, created and open, with its id. */
const withDocument = async (project?: string | null) => {
  const view = await openDocuments()
  await act(async () => {
    await view.result.current.create(project)
  })
  await waitFor(() => {
    expect(view.result.current.activeId).not.toBeNull()
  })

  const id = view.result.current.activeId
  if (id === null) throw new Error('no document was created')
  return { view, id }
}

describe('creating', () => {
  it('files a new document into the project it was started from', async () => {
    const { id } = await withDocument('Research')
    expect((await getDocument(id))?.project).toBe('Research')
  })

  it('leaves one created with no project unfiled', async () => {
    const { id } = await withDocument()
    expect((await getDocument(id))?.project).toBeNull()
  })
})

describe('autosave', () => {
  it('preserves the project and tags it knows nothing about', async () => {
    // `save` re-reads the record and spreads it, which is the only thing
    // stopping an autosave queued before a tag was added from erasing it.
    const { view, id } = await withDocument('Research')

    await act(async () => {
      await view.result.current.setTags(id, ['draft', 'urgent'])
    })
    await act(async () => {
      await view.result.current.save(id, body('written after'), 'written after')
    })

    const saved = await getDocument(id)
    expect(saved?.project).toBe('Research')
    expect(saved?.tags).toEqual(['draft', 'urgent'])
    expect(saved?.markdown).toBe('written after')
  })
})

describe('filing from the hook', () => {
  it('does not reorder the list, because filing is not editing', async () => {
    const view = await openDocuments()
    await act(async () => {
      await view.result.current.create()
    })
    await act(async () => {
      await view.result.current.create()
    })

    const before = view.result.current.documents.map(record => record.id)
    const last = before[before.length - 1]
    if (!last) throw new Error('expected two documents')

    await act(async () => {
      await view.result.current.setProject(last, 'Research')
    })

    expect(view.result.current.documents.map(record => record.id)).toEqual(before)
    expect(
      view.result.current.documents.find(record => record.id === last)?.project,
    ).toBe('Research')
  })

  it('reflects a bulk project rename in the list it is holding', async () => {
    const { view, id } = await withDocument('Research')

    await act(async () => {
      await view.result.current.renameProject('Research', 'Client work')
    })

    await waitFor(() => {
      expect(
        view.result.current.documents.find(record => record.id === id)?.project,
      ).toBe('Client work')
    })
  })

  it('reflects a bulk tag rename in the list it is holding', async () => {
    const { view, id } = await withDocument()

    await act(async () => {
      await view.result.current.setTags(id, ['draft'])
    })
    await act(async () => {
      await view.result.current.renameTag('draft', 'wip')
    })

    await waitFor(() => {
      expect(
        view.result.current.documents.find(record => record.id === id)?.tags,
      ).toEqual(['wip'])
    })
  })
})
