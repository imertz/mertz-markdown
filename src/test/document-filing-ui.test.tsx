import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentList } from '../components/documents/DocumentList'
import { makeDocument } from './dbHarness'

/**
 * Projects and tags in the document picker.
 *
 * This is the only surface either one has — there is no project store to open
 * and no tag manager elsewhere — so the menu is where the whole feature either
 * works or does not.
 */

afterEach(cleanup)

const notes = makeDocument({
  title: 'Notes on X',
  project: 'Research',
  tags: ['draft', 'urgent'],
})
const reading = makeDocument({
  title: 'Reading list',
  project: 'Research',
  tags: ['draft'],
})
const scratch = makeDocument({ title: 'Scratch' })

const setup = (documents = [notes, reading, scratch]) => {
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
    <DocumentList
      documents={documents}
      trashed={[]}
      activeId={documents[0]?.id ?? null}
      activeTitle={documents[0]?.title ?? ''}
      {...handlers}
    />,
  )

  return { ...handlers, user: userEvent.setup() }
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { expanded: false }))
}

/**
 * The active document's title is on the trigger as well as in the list, so an
 * unscoped `getByText` for it matches twice. Everything about the list itself
 * is asked of the menu.
 */
const menu = () => within(screen.getByRole('menu'))

describe('grouping by project', () => {
  it('sections the list, with the unfiled group last', async () => {
    const { user } = setup()
    await openMenu(user)

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map(node => node.textContent)

    expect(headings[0]).toContain('Research')
    expect(headings[1]).toContain('No project')
  })

  it('shows the active document’s project on the trigger', () => {
    setup()
    // The one place "where am I" is answered while the menu is shut.
    expect(
      screen.getByRole('button', { expanded: false }).textContent,
    ).toContain('Research /')
  })

  it('collapses a section without touching the documents in it', async () => {
    const { user } = setup()
    await openMenu(user)

    expect(menu().getByRole('button', { name: /Rename Notes on X/ })).toBeTruthy()
    await user.click(menu().getByRole('button', { name: /^Research/ }))
    expect(menu().queryByRole('button', { name: /Rename Notes on X/ })).toBeNull()
  })
})

describe('filtering', () => {
  it('narrows to documents carrying every selected tag', async () => {
    const { user } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Filter by draft (2)' }))
    expect(menu().queryByText('Scratch')).toBeNull()
    expect(menu().getByText('Reading list')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Filter by urgent (1)' }))
    expect(menu().queryByText('Reading list')).toBeNull()
    expect(menu().getByText('Notes on X')).toBeTruthy()
  })

  it('keeps every chip on screen while filtering, so the filter can be widened', async () => {
    const { user } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Filter by urgent (1)' }))
    // Counts come from the whole library, not the filtered view — a chip that
    // vanished as you used it could never be clicked again.
    expect(screen.getByRole('button', { name: 'Filter by draft (2)' })).toBeTruthy()
  })

  it('cannot collapse a section while a filter is on', async () => {
    const { user } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Filter by draft (2)' }))
    // A filtered list is a search result; hiding part of it behind a collapsed
    // heading would hide the very thing being looked for.
    expect(menu().getByRole('button', { name: /^Research/ })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('says so when nothing matches', async () => {
    const one = makeDocument({ title: 'One', tags: ['draft'] })
    const two = makeDocument({ title: 'Two', tags: ['urgent'] })
    const { user } = setup([one, two])
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Filter by draft (1)' }))
    await user.click(screen.getByRole('button', { name: 'Filter by urgent (1)' }))

    expect(menu().getByText(/No documents match/)).toBeTruthy()
  })

  it('offers a filter box only once the list is long enough to need one', async () => {
    const { user } = setup()
    await openMenu(user)
    expect(menu().queryByRole('textbox', { name: 'Filter documents' })).toBeNull()

    cleanup()
    const many = setup(
      Array.from({ length: 9 }, (_, index) =>
        makeDocument({ title: `Document ${index}` }),
      ),
    )
    await openMenu(many.user)

    const box = menu().getByRole('textbox', { name: 'Filter documents' })
    await many.user.type(box, 'doc7')
    expect(menu().getByText('Document 7')).toBeTruthy()
    expect(menu().queryByText('Document 3')).toBeNull()
  })
})

describe('tagging a document', () => {
  it('commits a comma-separated run as separate tags', async () => {
    const { user, onSetTags } = setup([scratch])
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Tags for Scratch' }))
    await user.type(screen.getByRole('textbox', { name: 'Tags for Scratch' }), 'idea,')

    expect(onSetTags).toHaveBeenCalledWith(scratch.id, ['idea'])
  })

  it('accumulates several tags typed faster than the write round-trip', async () => {
    // The handler is async in the app: each commit reaches IndexedDB and comes
    // back as a new prop. Typing beats that, so an editor that re-read the prop
    // would merge the second tag into the list as it was before the first —
    // dropping it. This asserts the editor owns the list while it is open.
    const { user, onSetTags } = setup([scratch])
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Tags for Scratch' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Tags for Scratch' }),
      'idea,#urgent,',
    )

    expect(onSetTags).toHaveBeenLastCalledWith(scratch.id, ['idea', 'urgent'])
  })

  it('abandons on Escape without saving', async () => {
    const { user, onSetTags } = setup([scratch])
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Tags for Scratch' }))
    const field = screen.getByRole('textbox', { name: 'Tags for Scratch' })
    await user.type(field, 'idea{Escape}')

    expect(onSetTags).not.toHaveBeenCalled()
    // Escape leaves the field, not the whole picker.
    expect(menu().getByText('Scratch')).toBeTruthy()
  })

  it('removes a tag from the row it belongs to', async () => {
    const { user, onSetTags } = setup([notes])
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Tags for Notes on X' }))
    await user.click(screen.getByRole('button', { name: 'Remove tag draft' }))

    expect(onSetTags).toHaveBeenCalledWith(notes.id, ['urgent'])
  })
})

describe('filing a document', () => {
  it('offers the projects already in use', async () => {
    const { user, onSetProject } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Project for Scratch' }))
    const submenu = screen.getByRole('group', { name: 'Project for Scratch' })
    await user.click(within(submenu).getByRole('button', { name: 'Research' }))

    expect(onSetProject).toHaveBeenCalledWith(scratch.id, 'Research')
  })

  it('creates a project by naming one, since there is nowhere else to', async () => {
    const { user, onSetProject } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Project for Scratch' }))
    await user.click(screen.getByRole('button', { name: '+ New project…' }))
    await user.type(
      screen.getByRole('textbox', { name: 'New project for Scratch' }),
      'Admin{Enter}',
    )

    expect(onSetProject).toHaveBeenCalledWith(scratch.id, 'Admin')
  })

  it('unfiles a document that has a project', async () => {
    const { user, onSetProject } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Project for Notes on X' }))
    const submenu = screen.getByRole('group', { name: 'Project for Notes on X' })
    await user.click(within(submenu).getByRole('button', { name: 'No project' }))

    expect(onSetProject).toHaveBeenCalledWith(notes.id, null)
  })
})

describe('creating inside a section', () => {
  it('files the new document into the project it was started from', async () => {
    const { user, onCreate } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'New document in Research' }))
    expect(onCreate).toHaveBeenCalledWith('Research')
  })

  it('leaves one started from the top of the menu unfiled', async () => {
    const { user, onCreate } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: '+ New document' }))
    expect(onCreate).toHaveBeenCalledWith()
  })
})

describe('editing the labels themselves', () => {
  it('renames a project from its heading', async () => {
    const { user, onRenameProject } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Rename project Research' }))
    const field = screen.getByRole('textbox', { name: 'Rename project Research' })
    await user.clear(field)
    await user.type(field, 'Client work{Enter}')

    expect(onRenameProject).toHaveBeenCalledWith('Research', 'Client work')
  })

  it('renames a tag everywhere, behind the manage toggle', async () => {
    const { user, onRenameTag } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Edit tags' }))
    await user.click(screen.getByRole('button', { name: 'Rename tag draft' }))
    const field = screen.getByRole('textbox', { name: 'Rename tag draft' })
    await user.clear(field)
    await user.type(field, 'wip{Enter}')

    expect(onRenameTag).toHaveBeenCalledWith('draft', 'wip')
  })

  it('deletes a tag everywhere from the same mode', async () => {
    const { user, onRenameTag } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Edit tags' }))
    await user.click(screen.getByRole('button', { name: 'Delete tag draft everywhere' }))

    expect(onRenameTag).toHaveBeenCalledWith('draft', null)
  })

  it('does not filter while the chips are in manage mode', async () => {
    const { user } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Edit tags' }))
    // The chip is a rename target now, not a filter, so nothing should narrow.
    expect(menu().getByText('Scratch')).toBeTruthy()
  })

  it('drops an active filter on the way into manage mode', async () => {
    const { user } = setup()
    await openMenu(user)

    await user.click(screen.getByRole('button', { name: 'Filter by draft (2)' }))
    expect(menu().queryByText('Scratch')).toBeNull()

    // A chip stops showing itself as pressed in here, so a list left narrowed
    // would have nothing lit to explain why.
    await user.click(screen.getByRole('button', { name: 'Edit tags' }))
    expect(menu().getByText('Scratch')).toBeTruthy()
  })
})
