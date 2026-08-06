import { Editor, type JSONContent } from '@tiptap/core'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { COMMENT_MARK_NAME, findMarkRanges } from '../editor/extensions/comment'
import { COMMENT_SANITIZER_RECHECK } from '../editor/extensions/commentSanitizer'
import { buildExtensions } from '../editor/extensions'
import { createThread } from '../db/threads'
import { useThreads } from '../hooks/useThreads'
import { makeComment, makeThread } from './dbHarness'
import { rangeOfText } from './editorHarness'

/**
 * Regression cover for anchors that vanished from the second comment onwards.
 *
 * CommentSanitizer strips any anchor whose thread id it does not recognise, and
 * it runs in appendTransaction — synchronously, inside the very transaction
 * that creates the anchor. addThread applied the mark before putting the thread
 * into React state, so a brand-new anchor was always judged foreign.
 *
 * The first comment survived by accident: the sanitizer bails when the known
 * set is empty, which it is until one thread exists. Every comment after that
 * lost its highlight while still getting a card.
 */

const anchorsFor = (editor: Editor, threadId: string) =>
  findMarkRanges(
    editor.state.doc,
    editor.schema.marks[COMMENT_MARK_NAME],
    threadId,
  )

const anchoredText = (editor: Editor) =>
  findMarkRanges(editor.state.doc, editor.schema.marks[COMMENT_MARK_NAME]).map(
    hit => editor.state.doc.textBetween(hit.from, hit.to),
  )

/** A document whose every word is anchored to the thread of the same name. */
const markedDocument = (...threadIds: string[]): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: threadIds.flatMap((threadId, index) => [
        ...(index ? [{ type: 'text', text: ' ' }] : []),
        {
          type: 'text',
          text: threadId,
          marks: [{ type: COMMENT_MARK_NAME, attrs: { threadId, resolved: false } }],
        },
      ]),
    },
  ],
})

describe('comment anchors survive the sanitizer', () => {
  it('treats a loaded zero-thread set as authoritative', async () => {
    const { result } = renderHook(() => useThreads('doc-no-threads'))
    await waitFor(() => expect(result.current.knownIdsRevision).toBeGreaterThan(0))

    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({
        getKnownThreadIds: () => result.current.getKnownIds(),
      }),
      content: markedDocument('foreign-thread'),
    })
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setMeta(COMMENT_SANITIZER_RECHECK, true),
      )
    })

    expect(anchorsFor(editor, 'foreign-thread')).toHaveLength(0)
    editor.destroy()
  })

  it('rechecks anchors that arrived while thread records were loading', async () => {
    const view = renderHook(() => useThreads('doc-loading-window'))
    expect(view.result.current.getKnownIds()).toBeNull()

    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({
        getKnownThreadIds: () => view.result.current.getKnownIds(),
      }),
      content: markedDocument('foreign-during-load'),
    })
    expect(anchorsFor(editor, 'foreign-during-load')).toHaveLength(1)

    await waitFor(() =>
      expect(view.result.current.knownIdsRevision).toBeGreaterThan(0),
    )
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setMeta(COMMENT_SANITIZER_RECHECK, true),
      )
    })

    expect(anchorsFor(editor, 'foreign-during-load')).toHaveLength(0)
    editor.destroy()
  })

  it('keeps the anchor for every thread, not just the first', async () => {
    const { result } = renderHook(() => useThreads('doc-sanitizer'))
    await waitFor(() => expect(result.current.threads).toEqual([]))

    // Wire the editor to the hook exactly as AppShell does.
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({
        getKnownThreadIds: () => result.current.getKnownIds(),
      }),
      content: 'alpha bravo charlie delta',
      contentType: 'markdown',
    })

    const addOn = async (word: string) => {
      editor.commands.setTextSelection(rangeOfText(editor, word))
      let id: string | null = null
      await act(async () => {
        id = await result.current.addThread(editor, `comment on ${word}`)
      })
      return id as string | null
    }

    const first = await addOn('alpha')
    const second = await addOn('bravo')
    const third = await addOn('charlie')

    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(third).toBeTruthy()

    // The bug produced three threads but only one surviving anchor.
    expect(anchorsFor(editor, first as string)).toHaveLength(1)
    expect(anchorsFor(editor, second as string)).toHaveLength(1)
    expect(anchorsFor(editor, third as string)).toHaveLength(1)
    expect(anchoredText(editor).sort()).toEqual(['alpha', 'bravo', 'charlie'])

    editor.destroy()
  })

  it('still strips an anchor whose thread is genuinely unknown', async () => {
    const { result } = renderHook(() => useThreads('doc-sanitizer-2'))
    await waitFor(() => expect(result.current.threads).toEqual([]))

    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({
        getKnownThreadIds: () => result.current.getKnownIds(),
      }),
      content: 'alpha bravo',
      contentType: 'markdown',
    })

    // One real thread, so the known set is non-empty and the sanitizer is live.
    editor.commands.setTextSelection(rangeOfText(editor, 'alpha'))
    await act(async () => {
      await result.current.addThread(editor, 'real')
    })

    // A foreign anchor, as a paste from another document would produce.
    editor.commands.setTextSelection(rangeOfText(editor, 'bravo'))
    editor.commands.setComment('pasted-from-elsewhere')

    expect(anchorsFor(editor, 'pasted-from-elsewhere')).toHaveLength(0)
    expect(anchoredText(editor)).toEqual(['alpha'])

    editor.destroy()
  })

  /**
   * A vault sync advances the document and the reload token together. AppShell
   * hands that token to useThreads before useMarkdownEditor, so the thread read
   * is still a pending promise when setContent replaces the buffer — and the
   * sanitizer runs inside that very transaction.
   *
   * While `threads` still held the pre-reload read, every anchor arriving with
   * the new content was judged foreign and stripped on the spot. The thread
   * records landed a tick later and could not put the marks back, and the next
   * ordinary edit autosaved the loss.
   */
  it('keeps anchors arriving with a sync reload, before the threads reload lands', async () => {
    const docId = 'doc-sanitizer-reload'
    const settled = makeThread(docId)
    await createThread(settled, makeComment(settled.id, docId))

    const view = renderHook(({ token }) => useThreads(docId, token), {
      initialProps: { token: 0 },
    })
    await waitFor(() => expect(view.result.current.threads).toHaveLength(1))

    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({
        getKnownThreadIds: () => view.result.current.getKnownIds(),
      }),
      content: markedDocument(settled.id),
    })
    expect(anchoredText(editor)).toEqual([settled.id])

    // Another paired device commented; the pull wrote the thread to IndexedDB.
    const arriving = makeThread(docId)
    await createThread(arriving, makeComment(arriving.id, docId))

    // The reload token advances and the content is replaced in the same commit,
    // while the thread read for that token has not resolved yet.
    act(() => view.rerender({ token: 1 }))
    editor.commands.setContent(markedDocument(settled.id, arriving.id), {
      emitUpdate: false,
    })

    expect(anchorsFor(editor, arriving.id)).toHaveLength(1)

    // Still there once the reload completes, and after an ordinary edit — the
    // edit is what used to make the loss durable by autosaving it.
    await waitFor(() => expect(view.result.current.threads).toHaveLength(2))
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, '!')
    expect(anchoredText(editor).sort()).toEqual([settled.id, arriving.id].sort())

    editor.destroy()
  })
})
