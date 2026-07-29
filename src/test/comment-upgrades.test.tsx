import { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommentThreadCard } from '../components/comments/CommentThreadCard'
import { buildExtensions } from '../editor/extensions'
import {
  COMMENT_MARK_NAME,
  findMarkRanges,
} from '../editor/extensions/comment'
import { useThreads } from '../hooks/useThreads'
import { toMarkdown } from '../markdown/export'
import { createTestEditor, rangeOfText } from './editorHarness'
import { makeComment, makeSelector, resetDatabase } from './dbHarness'
import type { ThreadWithComments } from '../types'

beforeEach(resetDatabase)
afterEach(cleanup)

const thread = (
  overrides: Partial<ThreadWithComments> = {},
): ThreadWithComments => {
  const now = Date.now()
  return {
    id: 't1',
    docId: 'doc-1',
    status: 'open',
    selector: makeSelector({ exact: 'the anchored words' }),
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    orphanedAt: null,
    comments: [makeComment('t1', 'doc-1', { body: 'First thoughts' })],
    ...overrides,
  }
}

describe('editing a comment', () => {
  const setup = (record = thread()) => {
    const onEdit = vi.fn()
    render(
      <CommentThreadCard
        thread={record}
        active
        onActivate={vi.fn()}
        onReply={vi.fn()}
        onEdit={onEdit}
        onResolve={vi.fn()}
        onDelete={vi.fn()}
        onReanchor={vi.fn()}
      />,
    )
    return { onEdit, user: userEvent.setup() }
  }

  it('opens the composer prefilled with what was written', async () => {
    const { user } = setup()

    await user.click(screen.getByLabelText('Edit comment'))
    const field = screen.getByLabelText('Edit comment…') as HTMLTextAreaElement

    expect(field.value).toBe('First thoughts')
    // Focused with the caret at the end, so the next key extends rather than
    // replaces.
    expect(document.activeElement).toBe(field)
    expect(field.selectionStart).toBe(field.value.length)
  })

  it('reports the rewritten body and leaves edit mode', async () => {
    const { user, onEdit } = setup()

    await user.click(screen.getByLabelText('Edit comment'))
    await user.keyboard(', on reflection')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEdit).toHaveBeenCalledWith(
      expect.any(String),
      'First thoughts, on reflection',
    )
    expect(screen.queryByLabelText('Edit comment…')).toBeNull()
  })

  it('discards the edit on cancel', async () => {
    const { user, onEdit } = setup()

    await user.click(screen.getByLabelText('Edit comment'))
    await user.keyboard(' scrapped')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByText('First thoughts')).toBeDefined()
  })

  it('marks a comment that has been edited', () => {
    const now = Date.now()
    setup(
      thread({
        comments: [
          makeComment('t1', 'doc-1', {
            body: 'Rewritten',
            createdAt: now - 5000,
            updatedAt: now,
          }),
        ],
      }),
    )

    expect(screen.getByText(/edited/)).toBeDefined()
  })
})

describe('useThreads.editComment', () => {
  it('rewrites the body and moves updatedAt past createdAt', async () => {
    const { result } = renderHook(() => useThreads('doc-edit'))
    await waitFor(() => expect(result.current.threads).toEqual([]))

    const editor = createTestEditor('alpha bravo charlie')
    await act(async () => {
      editor.commands.setTextSelection(rangeOfText(editor, 'bravo'))
      await result.current.addThread(editor, 'original')
    })

    const commentId = result.current.threads[0].comments[0].id
    await act(async () => {
      await result.current.editComment(commentId, '  amended  ')
    })

    const comment = result.current.threads[0].comments[0]
    expect(comment.body).toBe('amended')
    expect(comment.updatedAt).toBeGreaterThanOrEqual(comment.createdAt)
  })

  it('ignores an empty body rather than blanking the comment', async () => {
    const { result } = renderHook(() => useThreads('doc-edit-blank'))
    await waitFor(() => expect(result.current.threads).toEqual([]))

    const editor = createTestEditor('alpha bravo charlie')
    await act(async () => {
      editor.commands.setTextSelection(rangeOfText(editor, 'bravo'))
      await result.current.addThread(editor, 'keep me')
    })

    const commentId = result.current.threads[0].comments[0].id
    await act(async () => {
      await result.current.editComment(commentId, '   ')
    })

    expect(result.current.threads[0].comments[0].body).toBe('keep me')
  })
})

describe('useThreads.resolveAll', () => {
  it('resolves every open thread and leaves the rest alone', async () => {
    const { result } = renderHook(() => useThreads('doc-resolve-all'))
    await waitFor(() => expect(result.current.threads).toEqual([]))

    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({
        getKnownThreadIds: () => result.current.getKnownIds(),
      }),
      content: 'alpha bravo charlie delta echo',
      contentType: 'markdown',
    })

    for (const word of ['alpha', 'charlie', 'echo']) {
      await act(async () => {
        editor.commands.setTextSelection(rangeOfText(editor, word))
        await result.current.addThread(editor, `about ${word}`)
      })
    }

    // One is already resolved, so resolveAll must report three, not four.
    const first = result.current.threads[0].id
    await act(async () => {
      await result.current.resolve(editor, first, true)
    })

    const undoableBefore = undoDepth(editor.state)

    let count = 0
    await act(async () => {
      count = await result.current.resolveAll(editor)
    })

    expect(count).toBe(2)
    expect(
      result.current.threads.every(record => record.status === 'resolved'),
    ).toBe(true)

    // Anchors stay exactly where they were, and resolving three threads adds
    // nothing to the undo stack — it is metadata, not an edit.
    expect(
      findMarkRanges(editor.state.doc, editor.schema.marks[COMMENT_MARK_NAME]),
    ).not.toHaveLength(0)
    expect(undoDepth(editor.state)).toBe(undoableBefore)
    expect(toMarkdown(editor).trim()).toBe('alpha bravo charlie delta echo')
  })

  it('does nothing when there is nothing open', async () => {
    const { result } = renderHook(() => useThreads('doc-none-open'))
    await waitFor(() => expect(result.current.threads).toEqual([]))

    const editor = createTestEditor('alpha bravo')
    let count = -1
    await act(async () => {
      count = await result.current.resolveAll(editor)
    })

    expect(count).toBe(0)
  })
})
