import type { Editor } from '@tiptap/core'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../db/client'
import { useMarkdownEditor } from '../editor/useMarkdownEditor'
import { useDebouncedCallback } from '../hooks/useDebouncedCallback'
import { useDocuments } from '../hooks/useDocuments'
import { toMarkdown } from '../markdown/export'
import type { DocumentRecord } from '../types'
import { resetDatabase } from './dbHarness'

beforeEach(resetDatabase)

const AUTOSAVE_DELAY_MS = 800

/**
 * AppShell's sync wiring, reduced to the three hooks that race.
 *
 * When the engine observes a nonempty remote batch, AppShell makes the editor
 * read-only and flushes before the engine re-reads the outbox. The engine can
 * then skip any object that became locally dirty instead of applying over it.
 */
function useSyncedEditor() {
  const documents = useDocuments()
  const autosave = useDebouncedCallback(async (docId: string, editor: Editor) => {
    await documents.save(docId, editor.getJSON(), toMarkdown(editor))
  }, AUTOSAVE_DELAY_MS)

  const editor = useMarkdownEditor({
    activeId: documents.activeId,
    initialDoc: documents.initialDoc,
    reloadToken: documents.contentRevision,
    onDocChanged: instance => {
      if (documents.activeId) autosave.schedule(documents.activeId, instance)
    },
  })

  return {
    documents,
    autosave,
    editor,
    beforeRemoteBatch: async () => {
      editor?.setEditable(false, false)
      await autosave.flush()
    },
    onRemoteChange: async () => {
      await documents.refreshFromStorage()
    },
    afterRemoteBatch: () => editor?.setEditable(true, false),
  }
}

describe('remote reload during the autosave window', () => {
  it('commits a draft typed during the pull instead of replacing it', async () => {
    const view = renderHook(() => useSyncedEditor())
    await waitFor(() => {
      expect(view.result.current.documents.activeId).not.toBeNull()
      expect(view.result.current.editor).not.toBeNull()
    })

    // The ordinary pre-sync flush happens before the network request.
    await act(async () => view.result.current.autosave.flush())

    // The user keeps typing while the pull is in flight. This only schedules a
    // save; nothing has reached IndexedDB yet.
    act(() => {
      view.result.current.editor!.commands.insertContent('typed during sync')
    })
    expect(view.result.current.editor!.getText()).toContain('typed during sync')

    // A nonempty remote batch locks and flushes before applying anything.
    const id = view.result.current.documents.activeId!
    const db = await getDB()
    await act(async () => view.result.current.beforeRemoteBatch())
    expect(view.result.current.editor!.isEditable).toBe(false)

    // The engine now sees a pending outbox row and skips the remote head. The
    // draft is already durable before the editor becomes editable again.
    const stored = await db.get('documents', id)
    expect(stored?.markdown).toContain('typed during sync')
    expect(view.result.current.editor!.getText()).toContain('typed during sync')
    expect(await db.get('syncOutbox', `document:${id}`)).toBeTruthy()
    act(() => view.result.current.afterRemoteBatch())
    expect(view.result.current.editor!.isEditable).toBe(true)

    // And it survives the debounce elapsing, because the pending save now has
    // nothing left to write over it.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, AUTOSAVE_DELAY_MS + 100))
    })
    expect((await db.get('documents', id))?.markdown).toContain('typed during sync')

    view.unmount()
  })

  it('reloads normally when nothing was typed during the pull', async () => {
    const view = renderHook(() => useSyncedEditor())
    await waitFor(() => {
      expect(view.result.current.documents.activeId).not.toBeNull()
      expect(view.result.current.editor).not.toBeNull()
    })
    await act(async () => view.result.current.autosave.flush())

    const id = view.result.current.documents.activeId!
    const db = await getDB()
    const existing = (await db.get('documents', id)) as DocumentRecord
    await act(async () => view.result.current.beforeRemoteBatch())
    await db.put('documents', {
      ...existing,
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'remote replacement' }] },
        ],
      },
      markdown: 'remote replacement\n',
      updatedAt: existing.updatedAt + 1,
    })

    await act(async () => view.result.current.onRemoteChange())

    // flush() is a no-op with nothing pending, so the remote content lands.
    await waitFor(() => {
      expect(view.result.current.editor!.getText()).toBe('remote replacement')
    })
    act(() => view.result.current.afterRemoteBatch())
    expect(view.result.current.editor!.isEditable).toBe(true)

    view.unmount()
  })
})
