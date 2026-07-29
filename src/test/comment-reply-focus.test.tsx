import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommentThreadCard } from '../components/comments/CommentThreadCard'
import type { ThreadWithComments } from '../types'

/**
 * Regression cover for a bug that made replies impossible to write.
 *
 * The card activates its thread on click and on focus, and activating focuses
 * the *editor* (CommentSidebar.activate runs `editor.chain().focus()`). Because
 * `focusin` bubbles, every interaction inside the card — including clicking
 * into the reply textarea — re-activated the thread and yanked focus into the
 * document, so the user's keystrokes were typed into their prose instead of
 * into the reply, and the submit button could never leave its disabled state.
 *
 * These tests assert the guard from the card side: interactions with the card's
 * own controls must not call onActivate, while clicking the card body still
 * must. userEvent (not fireEvent) matters here — only it moves real focus.
 */

const thread = (): ThreadWithComments => ({
  id: 'thread-1',
  docId: 'doc-1',
  status: 'open',
  selector: { exact: 'plaintext', prefix: 'stored as ', suffix: ' in the' },
  createdAt: 1,
  updatedAt: 1,
  resolvedAt: null,
  orphanedAt: null,
  comments: [
    {
      id: 'comment-1',
      threadId: 'thread-1',
      docId: 'doc-1',
      body: 'First comment',
      author: 'You',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
})

const setup = () => {
  const handlers = {
    onActivate: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onResolve: vi.fn(),
    onDelete: vi.fn(),
    onReanchor: vi.fn(),
  }
  render(<CommentThreadCard thread={thread()} active {...handlers} />)
  return { user: userEvent.setup(), ...handlers }
}

afterEach(cleanup)

describe('CommentThreadCard reply focus', () => {
  it('does not activate the thread when the Reply button is pressed', async () => {
    const { user, onActivate } = setup()

    await user.click(screen.getByRole('button', { name: 'Reply' }))

    expect(screen.getByLabelText('Reply…')).toBeDefined()
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('keeps focus in the textarea and accepts typing', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'Reply' }))
    const field = screen.getByLabelText('Reply…') as HTMLTextAreaElement

    // The composer autofocuses; clicking into it must not hand focus away.
    await user.click(field)
    expect(document.activeElement).toBe(field)

    await user.type(field, 'looks good')
    expect(field.value).toBe('looks good')
    expect(document.activeElement).toBe(field)
  })

  it('does not activate the thread while the composer is used', async () => {
    const { user, onActivate } = setup()

    await user.click(screen.getByRole('button', { name: 'Reply' }))
    const field = screen.getByLabelText('Reply…')
    await user.click(field)
    await user.type(field, 'looks good')

    // Both the click and the resulting focusin used to reach the card.
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('submits the typed body', async () => {
    const { user, onReply } = setup()

    await user.click(screen.getByRole('button', { name: 'Reply' }))
    await user.type(screen.getByLabelText('Reply…'), 'looks good')
    // Two "Reply" buttons exist while composing; the submit one is last.
    const submit = screen.getAllByRole('button', { name: /^Reply/ }).at(-1)
    await user.click(submit as HTMLElement)

    expect(onReply).toHaveBeenCalledWith('looks good')
  })

  it('still activates when the card body is clicked', async () => {
    const { user, onActivate } = setup()

    await user.click(screen.getByText('First comment'))

    expect(onActivate).toHaveBeenCalled()
  })

  it('does not activate when Resolve or Delete are pressed', async () => {
    const { user, onActivate, onResolve, onDelete } = setup()

    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onResolve).toHaveBeenCalledWith(true)
    expect(onDelete).toHaveBeenCalled()
    expect(onActivate).not.toHaveBeenCalled()
  })
})
