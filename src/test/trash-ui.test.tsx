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

/** The trash is a shut footer; everything in it is one click behind the bar. */
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /Trash \(\d+\)/ }))
}

describe('trash in the document picker', () => {
  it('is absent entirely when the trash is empty', () => {
    setup([])

    expect(screen.queryByText(/^Trash/)).toBeNull()
  })

  it('is a shut bar until asked, and says what it holds and for how long', () => {
    setup()

    const bar = screen.getByRole('button', { name: /Trash \(1\)/ })
    expect(bar.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('cleared after 30 days')).toBeDefined()
    // The rows are in the document but not exposed — the bar is the way in.
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
  })

  it('opens on a click', async () => {
    const { user } = setup()

    await open(user)

    expect(screen.getByText('Old draft')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDefined()
  })

  it('restores on request and stays put, because a sidebar is a fixture', async () => {
    // It used to assert the menu closed. The sidebar does not: the row leaves
    // on the next render because `trashed` no longer holds it, not because the
    // panel got out of the way.
    const { user, onRestore } = setup()
    await open(user)

    await user.click(screen.getByRole('button', { name: 'Restore' }))

    expect(onRestore).toHaveBeenCalledWith(gone.id)
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDefined()
  })

  it('takes two clicks to delete a document for good', async () => {
    const { user, onDestroy } = setup()
    await open(user)

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
