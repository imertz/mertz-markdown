import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UndoToast } from '../components/UndoToast'
import { DocumentLibrary } from '../components/documents/DocumentLibrary'
import { makeDocument } from './dbHarness'

afterEach(cleanup)

const live = makeDocument({ title: 'Working notes' })
const gone = makeDocument({ title: 'Old draft', deletedAt: Date.now() })

const setup = (trashed = [gone]) => {
  const handlers = {
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    onDestroy: vi.fn(),
    onRename: vi.fn(),
    onSetProject: vi.fn(),
    onSetTags: vi.fn(),
    onRenameProject: vi.fn(),
    onRenameTag: vi.fn(),
  }
  render(
    <DocumentLibrary
      documents={[live]}
      trashed={trashed}
      activeId={live.id}
      {...handlers}
    />,
  )
  return { ...handlers, user: userEvent.setup() }
}

describe('trash in the document picker', () => {
  it('is absent entirely when the trash is empty', () => {
    setup([])

    expect(screen.queryByText(/^Trash/)).toBeNull()
  })

  it('lists trashed documents under a heading that says when they go', () => {
    setup()

    expect(screen.getByText('Trash (1)')).toBeDefined()
    expect(screen.getByText('cleared after 30 days')).toBeDefined()
    expect(screen.getByText('Old draft')).toBeDefined()
  })

  it('restores on request and stays put, because a sidebar is a fixture', async () => {
    // It used to assert the menu closed. The sidebar does not: the row leaves
    // on the next render because `trashed` no longer holds it, not because the
    // panel got out of the way.
    const { user, onRestore } = setup()

    await user.click(screen.getByRole('button', { name: 'Restore' }))

    expect(onRestore).toHaveBeenCalledWith(gone.id)
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDefined()
  })

  it('takes two clicks to delete a document for good', async () => {
    const { user, onDestroy } = setup()

    await user.click(screen.getByLabelText('Delete Old draft for good'))
    // Nothing yet — the button has only changed what it says.
    expect(onDestroy).not.toHaveBeenCalled()

    await user.click(
      screen.getByLabelText('Confirm deleting Old draft for good'),
    )
    expect(onDestroy).toHaveBeenCalledWith(gone.id)
  })

  it('sends a live document to the trash rather than deleting it', async () => {
    const { user, onDelete } = setup()

    await user.click(screen.getByLabelText('Move Working notes to trash'))
    expect(onDelete).toHaveBeenCalledWith(live.id)
  })
})

describe('UndoToast', () => {
  it('offers the undo and reports it', async () => {
    const onUndo = vi.fn()
    render(
      <UndoToast message="Deleted “Old draft”" onUndo={onUndo} onDismiss={vi.fn()} />,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalled()
  })

  it('withdraws the offer once the window closes', () => {
    vi.useFakeTimers()
    try {
      const onDismiss = vi.fn()
      render(
        <UndoToast
          message="Deleted “Old draft”"
          timeoutMs={6000}
          onUndo={vi.fn()}
          onDismiss={onDismiss}
        />,
      )

      act(() => vi.advanceTimersByTime(5999))
      expect(onDismiss).not.toHaveBeenCalled()

      act(() => vi.advanceTimersByTime(1))
      expect(onDismiss).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
