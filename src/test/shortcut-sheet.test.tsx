import type { Editor } from '@tiptap/core'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShortcutSheet } from '../components/keys/ShortcutSheet'
import type { CommandContext } from '../keys/context'
import type { CommandDeps } from '../keys/registry'
import { buildCommands } from '../keys/registry'
import { REPO_URL } from '../lib/repo'

afterEach(cleanup)

/** The real registry, so the sheet is tested against what actually ships. */
function realCommands() {
  const noop = vi.fn()
  const deps: CommandDeps = {
    editor: null,
    documents: {
      documents: [
        { id: 'doc-1', title: 'Notes', updatedAt: 0 },
        { id: 'doc-2', title: 'Draft', updatedAt: 0 },
      ],
      activeId: 'doc-1',
      select: noop,
    } as never,
    threads: { resolveAll: noop } as never,
    rail: { hidden: false, toggle: noop, show: noop },
    theme: { theme: 'light', toggle: noop },
    focus: { on: false, toggle: noop },
    ui: new Proxy({}, { get: () => noop }) as never,
  }
  return buildCommands(deps)
}

function makeContext(over: Partial<CommandContext> = {}): CommandContext {
  return {
    editor: { isDestroyed: false } as Editor,
    hasSelection: false,
    inTable: false,
    overlay: 'cheatsheet',
    documentCount: 2,
    activeDocumentId: 'doc-1',
    railHidden: false,
    theme: 'light',
    ...over,
  }
}

function show(over: Partial<CommandContext> = {}, onClose = vi.fn()) {
  const result = render(
    <ShortcutSheet
      commands={realCommands()}
      context={makeContext(over)}
      onClose={onClose}
    />,
  )
  return { ...result, onClose }
}

describe('ShortcutSheet', () => {
  it('is a modal dialog with the filter focused', () => {
    show()
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy()
    expect(document.activeElement).toBe(
      screen.getByLabelText('Filter shortcuts'),
    )
  })

  it('documents the chords Tiptap delivers, which nothing else surfaced', () => {
    show()
    expect(screen.getByText('Bold')).toBeTruthy()
    expect(screen.getByText('Undo')).toBeTruthy()
    expect(screen.getByText('Next cell')).toBeTruthy()
  })

  it('groups in category order', () => {
    const { container } = show()
    const headings = [...container.querySelectorAll('.sheet__group-title')].map(
      node => node.textContent?.trim().split('with')[0].trim(),
    )
    expect(headings[0]).toBe('App')
    expect(headings).toContain('Format')
    expect(headings.at(-1)).toBe('Table')
  })

  it('marks a context-gated group inactive rather than hiding it', () => {
    // "These exist, and here is what they need" beats an absence the reader
    // has to notice.
    const { container } = show({ inTable: false })
    const table = container.querySelector('.sheet__group--inactive')

    expect(table?.textContent).toContain('Table')
    expect(table?.textContent).toContain('with the cursor in a table')
  })

  it('marks the same group active once the cursor is in a table', () => {
    const { container } = show({ inTable: true })
    const inactive = [...container.querySelectorAll('.sheet__group--inactive')]

    expect(inactive.some(node => node.textContent?.includes('Table'))).toBe(
      false,
    )
  })

  it('carries the caveat for a chord the browser keeps', () => {
    show()
    expect(
      screen.getByText(/the browser keeps this one/),
    ).toBeTruthy()
  })

  it('filters by label and by chord', async () => {
    const user = userEvent.setup()
    show()
    const filter = screen.getByLabelText('Filter shortcuts')

    await user.type(filter, 'blockquote')
    expect(screen.getByText('Blockquote')).toBeTruthy()
    expect(screen.queryByText('Command palette')).toBeNull()

    await user.clear(filter)
    await user.type(filter, 'zzzz')
    expect(screen.getByText('No matching shortcuts')).toBeTruthy()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const { onClose } = show()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('links to the repository, in a new tab that cannot see this one', () => {
    show()

    const link = screen.getByRole('link', { name: /source on github/i })
    expect(link.getAttribute('href')).toBe(REPO_URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
  })

  it('keeps the footer while the list is filtered away', async () => {
    const user = userEvent.setup()
    show()

    // It is a sibling of the scrolling body, not its last row, so an empty
    // result must not take it with it.
    await user.type(screen.getByLabelText('Filter shortcuts'), 'zzzz')

    expect(screen.getByText('No matching shortcuts')).toBeTruthy()
    expect(screen.getByRole('link', { name: /source on github/i })).toBeTruthy()
  })
})
