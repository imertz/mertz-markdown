import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibrarySidebar } from '../components/documents/LibrarySidebar'
import { makeDocument } from './dbHarness'

/**
 * The library's housing.
 *
 * One list, two behaviours. Docked it is a fixture — it does not move when you
 * use it. As a drawer it sits on top of the editor, and everything that follows
 * from that (Escape, the scrim, getting out of the way once you have opened
 * something) is what these cover.
 */

afterEach(cleanup)

const notes = makeDocument({ title: 'Notes on X', project: 'Research' })
const scratch = makeDocument({ title: 'Scratch' })

const setup = (drawer: boolean) => {
  const handlers = {
    onClose: vi.fn(),
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
    <LibrarySidebar
      drawer={drawer}
      documents={[notes, scratch]}
      trashed={[]}
      activeId={notes.id}
      {...handlers}
    />,
  )

  return { ...handlers, user: userEvent.setup() }
}

describe('docked', () => {
  it('stays open when a document is picked', async () => {
    // The whole point of a sidebar over the dropdown it replaced: it never
    // takes itself away, so the next document is one click rather than two.
    const { user, onSelect, onClose } = setup(false)

    await user.click(screen.getByRole('button', { name: /^Scratch/ }))

    expect(onSelect).toHaveBeenCalledWith(scratch.id)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores Escape, which belongs to the editor', async () => {
    const { user, onClose } = setup(false)

    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })

  it('is announced as the library, and closable by the button', async () => {
    const { user, onClose } = setup(false)

    expect(screen.getByRole('complementary', { name: 'Library' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Close library' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('as a drawer', () => {
  it('closes once a document has been opened, having covered it', async () => {
    const { user, onSelect, onClose } = setup(true)

    await user.click(screen.getByRole('button', { name: /^Scratch/ }))

    expect(onSelect).toHaveBeenCalledWith(scratch.id)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const { user, onClose } = setup(true)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('closes after starting a new document', async () => {
    const { user, onCreate, onClose } = setup(true)

    await user.click(screen.getByRole('button', { name: '+ New document' }))

    expect(onCreate).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('stands the global chords down while it owns the screen', () => {
    setup(true)

    expect(
      screen.getByRole('complementary', { name: 'Library' }),
    ).toHaveProperty('dataset.keys', 'overlay')
  })
})
