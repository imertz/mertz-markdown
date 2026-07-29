import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentList } from '../components/documents/DocumentList'
import { makeDocument } from './dbHarness'

/**
 * Renaming from the document picker. Titles are otherwise derived from the
 * content on every save, so the field's job is to say "stop deriving" — and an
 * empty submission is the only way back.
 */

afterEach(cleanup)

const setup = (
  document_ = makeDocument({ title: 'Working notes' }),
  trashed: ReturnType<typeof makeDocument>[] = [],
) => {
  const handlers = {
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    onDestroy: vi.fn(),
    onRename: vi.fn(),
  }

  render(
    <DocumentList
      documents={[document_]}
      trashed={trashed}
      activeId={document_.id}
      activeTitle={document_.title}
      {...handlers}
    />,
  )

  return { ...handlers, document_, user: userEvent.setup() }
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { expanded: false }))
}

const startRename = async (
  user: ReturnType<typeof userEvent.setup>,
  title = 'Working notes',
) => {
  await openMenu(user)
  await user.click(screen.getByRole('button', { name: `Rename ${title}` }))
  return screen.getByRole('textbox', { name: `Name for ${title}` })
}

describe('renaming from the document picker', () => {
  it('opens an empty field on a document that never had a name', async () => {
    // Seeding the derived title would mean pressing Enter on an untouched
    // field silently pins text the user never chose.
    const { user } = setup()

    expect(await startRename(user)).toHaveProperty('value', '')
  })

  it('opens on the existing name when there is one to edit', async () => {
    const { user } = setup(
      makeDocument({ title: 'Q3 plan', titleOverride: 'Q3 plan' }),
    )

    expect(await startRename(user, 'Q3 plan')).toHaveProperty('value', 'Q3 plan')
  })

  it('saves the typed name on Enter', async () => {
    const { user, onRename, document_ } = setup()
    const field = await startRename(user)

    await user.type(field, 'Release notes{Enter}')

    expect(onRename).toHaveBeenCalledWith(document_.id, 'Release notes')
  })

  it('saves on blur, so clicking away does not lose the typing', async () => {
    const { user, onRename, document_ } = setup()
    const field = await startRename(user)

    await user.type(field, 'Release notes')
    await user.tab()

    expect(onRename).toHaveBeenCalledWith(document_.id, 'Release notes')
  })

  it('discards on Escape without closing the whole picker', async () => {
    const { user, onRename } = setup()
    const field = await startRename(user)

    await user.type(field, 'Never mind{Escape}')

    expect(onRename).not.toHaveBeenCalled()
    // The picker's own Escape closes the menu; the rename swallowed this one.
    expect(screen.getByRole('button', { name: 'Rename Working notes' })).toBeDefined()
  })

  it('submits the empty name that hands the title back to the content', async () => {
    const { user, onRename, document_ } = setup(
      makeDocument({ title: 'Q3 plan', titleOverride: 'Q3 plan' }),
    )
    const field = await startRename(user, 'Q3 plan')

    await user.clear(field)
    await user.type(field, '{Enter}')

    expect(onRename).toHaveBeenCalledWith(document_.id, '')
  })

  it('leaves trashed documents unrenameable', async () => {
    // Naming something on its way out is busywork; the trash row offers
    // Restore and Delete and nothing else.
    const { user } = setup(makeDocument({ title: 'Working notes' }), [
      makeDocument({ title: 'Old draft', deletedAt: Date.now() }),
    ])
    await openMenu(user)

    expect(screen.getByText('Old draft')).toBeDefined()
    expect(screen.getAllByRole('button', { name: /^Rename / })).toHaveLength(1)
  })
})
