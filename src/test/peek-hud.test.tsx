import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PeekHud } from '../components/keys/PeekHud'
import { CATALOG } from '../keys/catalog'
import type { Command } from '../keys/context'

afterEach(cleanup)

const command = (id: keyof typeof CATALOG): Command => ({
  ...CATALOG[id],
  id,
  run: vi.fn(),
})

const COMMANDS: Command[] = [
  command('app.palette'), // ⌘K
  command('find.open'), // ⌘F
  command('find.searchAll'), // ⌘⇧F
  command('comment.add'), // ⌘⌥M / Alt+M
  command('insert.table'), // no chord at all
]

const HELD_MOD = { mod: true, alt: false, shift: false }

describe('PeekHud', () => {
  it('lists only the chords using exactly the modifiers held', () => {
    render(<PeekHud held={HELD_MOD} commands={COMMANDS} />)

    expect(screen.getByText('Command palette')).toBeTruthy()
    expect(screen.getByText('Find in document')).toBeTruthy()
    // ⌘⇧F needs Shift too, so it is a different question.
    expect(screen.queryByText('Search all documents')).toBeNull()
    expect(screen.queryByText('Comment on selection')).toBeNull()
  })

  it('leaves out commands with no chord to press', () => {
    render(<PeekHud held={HELD_MOD} commands={COMMANDS} />)
    expect(screen.queryByText('Insert table')).toBeNull()
  })

  it('narrows as a modifier is added', () => {
    render(
      <PeekHud
        held={{ mod: true, alt: false, shift: true }}
        commands={COMMANDS}
      />,
    )

    expect(screen.getByText('Search all documents')).toBeTruthy()
    expect(screen.queryByText('Command palette')).toBeNull()
  })

  it('renders nothing when no modifier is being held', () => {
    const { container } = render(<PeekHud held={null} commands={COMMANDS} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the held modifiers reach no command', () => {
    const { container } = render(
      <PeekHud
        held={{ mod: false, alt: false, shift: true }}
        commands={COMMANDS}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('prints the key alone, since the modifiers are in the heading', () => {
    const { container } = render(
      <PeekHud held={HELD_MOD} commands={[command('app.palette')]} />,
    )

    const keys = [...container.querySelectorAll('.kbd')].map(k => k.textContent)
    expect(keys).toEqual(['K'])
  })

  it('is invisible to assistive tech and holds nothing focusable', () => {
    // It is a hint over a document the reader is still editing: the caret has
    // to keep blinking where it was, and the palette already reads out every
    // one of these commands properly.
    const { container } = render(<PeekHud held={HELD_MOD} commands={COMMANDS} />)
    const panel = container.querySelector('.peek') as HTMLElement

    expect(panel.getAttribute('aria-hidden')).toBe('true')
    expect(
      panel.querySelectorAll('button, a, input, [tabindex]'),
    ).toHaveLength(0)
  })

  it('does not move focus when it appears', () => {
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()

    render(<PeekHud held={HELD_MOD} commands={COMMANDS} />)

    expect(document.activeElement).toBe(field)
    field.remove()
  })
})
