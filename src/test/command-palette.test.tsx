import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaletteAction } from '../components/CommandPalette'
import { CommandPalette } from '../components/CommandPalette'

afterEach(cleanup)

const build = () => {
  const ran: string[] = []
  const actions: PaletteAction[] = [
    { id: 'a', label: 'New document', run: () => ran.push('new') },
    { id: 'b', label: 'Export as Markdown', run: () => ran.push('export') },
    {
      id: 'c',
      label: 'Release notes',
      hint: 'Document · 2h ago',
      run: () => ran.push('release'),
    },
    { id: 'd', label: 'Summary', hint: 'Heading 2', run: () => ran.push('sum') },
  ]
  return { ran, actions }
}

const setup = () => {
  const { ran, actions } = build()
  const onClose = vi.fn()
  render(<CommandPalette actions={actions} onClose={onClose} />)
  return { ran, onClose, user: userEvent.setup() }
}

const options = () => screen.getAllByRole('option')
const selected = () =>
  options().find(option => option.getAttribute('aria-selected') === 'true')

describe('CommandPalette', () => {
  it('opens focused, listing everything in registry order', () => {
    setup()
    expect(document.activeElement).toBe(screen.getByLabelText('Command palette'))
    expect(options()).toHaveLength(4)
    expect(options()[0].textContent).toContain('New document')
  })

  it('narrows to fuzzy matches as the query is typed', async () => {
    const { user } = setup()

    await user.keyboard('sum')
    expect(options()).toHaveLength(1)
    expect(options()[0].textContent).toContain('Summary')
  })

  it('runs the selected action with Enter and then closes', async () => {
    const { user, ran, onClose } = setup()

    await user.keyboard('export{Enter}')
    expect(ran).toEqual(['export'])
    expect(onClose).toHaveBeenCalled()
  })

  it('walks the list with the arrow keys, wrapping at the ends', async () => {
    const { user, ran } = setup()

    await user.keyboard('{ArrowDown}')
    expect(selected()?.textContent).toContain('Export as Markdown')

    // Up from the second row lands back on the first, up again wraps to last.
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(selected()?.textContent).toContain('Summary')

    await user.keyboard('{Enter}')
    expect(ran).toEqual(['sum'])
  })

  it('keeps Enter working when a query shortens the list under the cursor', async () => {
    const { user, ran } = setup()

    // Move the cursor past where the filtered list will end, then filter.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    await user.keyboard('new')
    await user.keyboard('{Enter}')

    expect(ran).toEqual(['new'])
  })

  it('says so when nothing matches', async () => {
    const { user } = setup()

    await user.keyboard('zzzz')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matches')).toBeDefined()
  })

  it('shows each row hint alongside its label', () => {
    setup()
    expect(screen.getByText('Document · 2h ago')).toBeDefined()
    expect(screen.getByText('Heading 2')).toBeDefined()
  })
})
