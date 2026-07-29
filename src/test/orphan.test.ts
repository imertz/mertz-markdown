import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  COMMENT_MARK_NAME,
  collectAnchoredThreadIds,
} from '../editor/extensions/comment'
import { putDocument } from '../db/documents'
import { createThread } from '../db/threads'
import { useThreads } from '../hooks/useThreads'
import {
  makeComment,
  makeDocument,
  makeThread,
  resetDatabase,
} from './dbHarness'
import { createTestEditor, rangeOfText } from './editorHarness'

beforeEach(resetDatabase)

describe('anchor detection', () => {
  it('drops the thread id when its text is deleted', () => {
    const editor = createTestEditor('alpha bravo charlie\n')
    const range = rangeOfText(editor, 'bravo')
    editor.commands.setTextSelection(range)
    editor.commands.setComment('t1')
    expect(collectAnchoredThreadIds(editor.state.doc)).toEqual(new Set(['t1']))

    editor.commands.deleteRange(rangeOfText(editor, 'bravo'))
    expect(collectAnchoredThreadIds(editor.state.doc)).toEqual(new Set())

    editor.destroy()
  })

  it('restores the thread id on undo', () => {
    const editor = createTestEditor('alpha bravo charlie\n')
    editor.commands.setTextSelection(rangeOfText(editor, 'bravo'))
    editor.commands.setComment('t1')
    editor.commands.deleteRange(rangeOfText(editor, 'bravo'))
    expect(collectAnchoredThreadIds(editor.state.doc)).toEqual(new Set())

    editor.commands.undo()
    expect(collectAnchoredThreadIds(editor.state.doc)).toEqual(new Set(['t1']))

    editor.destroy()
  })

  it('stays anchored when only the middle of the span is deleted', () => {
    // Fragmentation is not orphaning: the thread now has two ranges, but the
    // collector returns a Set, so it is still present exactly once.
    const editor = createTestEditor('one two three four five\n')
    editor.commands.setTextSelection(rangeOfText(editor, 'two three four'))
    editor.commands.setComment('t1')

    editor.commands.deleteRange(rangeOfText(editor, 'three'))

    expect(collectAnchoredThreadIds(editor.state.doc)).toEqual(new Set(['t1']))
    const type = editor.schema.marks[COMMENT_MARK_NAME]
    expect(type).toBeDefined()
    editor.destroy()
  })
})

describe('orphan reconciliation', () => {
  // Deliberately NOT using fake timers: fake-indexeddb drives its requests off
  // the real event loop, so faking timers deadlocks every DB call in the hook.
  // Real waits keep this honest and still run in a couple of seconds.
  const WAIT = { timeout: 3000 }

  const seed = async () => {
    const document_ = makeDocument()
    await putDocument(document_)
    const thread = makeThread(document_.id)
    await createThread(thread, makeComment(thread.id, document_.id))
    return { docId: document_.id, threadId: thread.id }
  }

  it('marks a thread orphaned once the grace period elapses', async () => {
    const { docId, threadId } = await seed()
    const { result } = renderHook(() => useThreads(docId))

    await waitFor(() => {
      expect(result.current.threads).toHaveLength(1)
    }, WAIT)

    act(() => {
      result.current.onAnchorsChanged(new Set())
    })
    // Nothing changes immediately — that is the point of the grace period.
    expect(result.current.threads[0]?.status).toBe('open')

    await waitFor(() => {
      expect(result.current.threads[0]?.status).toBe('orphaned')
    }, WAIT)
    expect(result.current.threads[0]?.id).toBe(threadId)
    expect(result.current.threads[0]?.orphanedAt).not.toBeNull()
  })

  it('revives an orphaned thread when its anchor comes back', async () => {
    const { docId, threadId } = await seed()
    const { result } = renderHook(() => useThreads(docId))
    await waitFor(() => {
      expect(result.current.threads).toHaveLength(1)
    }, WAIT)

    act(() => {
      result.current.onAnchorsChanged(new Set())
    })
    await waitFor(() => {
      expect(result.current.threads[0]?.status).toBe('orphaned')
    }, WAIT)

    // This is what an undo looks like to the reconciler.
    act(() => {
      result.current.onAnchorsChanged(new Set([threadId]))
    })
    await waitFor(() => {
      expect(result.current.threads[0]?.status).toBe('open')
    }, WAIT)
    expect(result.current.threads[0]?.orphanedAt).toBeNull()
  })

  it('never flips status when a cut is pasted back inside the grace period', async () => {
    const { docId, threadId } = await seed()
    const { result } = renderHook(() => useThreads(docId))
    await waitFor(() => {
      expect(result.current.threads).toHaveLength(1)
    }, WAIT)

    // Cut…
    act(() => {
      result.current.onAnchorsChanged(new Set())
    })
    await new Promise(resolve => setTimeout(resolve, 250))
    // …paste, comfortably inside the 600 ms window. The pending timer is reset.
    act(() => {
      result.current.onAnchorsChanged(new Set([threadId]))
    })
    await new Promise(resolve => setTimeout(resolve, 900))

    expect(result.current.threads[0]?.status).toBe('open')
    expect(result.current.threads[0]?.orphanedAt).toBeNull()
  })

  it('does not orphan anything before threads have loaded', async () => {
    const { docId } = await seed()
    const { result } = renderHook(() => useThreads(docId))

    // Fire immediately, before the load promise resolves.
    act(() => {
      result.current.onAnchorsChanged(new Set())
    })
    await new Promise(resolve => setTimeout(resolve, 900))

    await waitFor(() => {
      expect(result.current.threads).toHaveLength(1)
    }, WAIT)
    expect(result.current.threads[0]?.status).toBe('open')
  })
})
