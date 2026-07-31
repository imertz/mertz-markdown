import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportMenu, type ExportMenuProps } from '../components/documents/ExportMenu'

afterEach(cleanup)

function setup(overrides: Partial<ExportMenuProps> = {}) {
  const handlers = {
    onExport: vi.fn(),
    onExportDocx: vi.fn(),
    onExportDocxAnnotated: vi.fn(),
    onExportAnnotated: vi.fn(),
    onImport: vi.fn(),
  }
  render(<ExportMenu {...handlers} {...overrides} />)
  return { ...handlers, user: userEvent.setup() }
}

const trigger = () => screen.getByRole('button', { name: /^Export/ })

describe('export menu', () => {
  it('keeps the formats behind the trigger until it is opened', () => {
    setup()

    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    // Import is a peer, not a format, so it stays reachable throughout.
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy()
  })

  it('offers every format once opened', async () => {
    const { user } = setup()
    await user.click(trigger())

    const names = screen
      .getAllByRole('menuitem')
      .map(item => item.textContent ?? '')

    expect(names[0]).toContain('Markdown')
    expect(names[1]).toContain('Word')
    expect(names[2]).toContain('Word, with comments')
    expect(names[3]).toContain('HTML, with comments')
    expect(names).toHaveLength(4)
  })

  it('says which formats carry the comments', async () => {
    const { user } = setup()
    await user.click(trigger())

    const [markdown, word] = screen.getAllByRole('menuitem')
    // The distinction the app cares most about has to be legible before the
    // click, not discovered afterwards in the downloaded file.
    expect(markdown?.textContent).toContain('Never any comments')
    expect(word?.textContent).toContain('No comments')
  })

  it.each([
    ['Markdown', 'onExport'],
    ['Word, with comments', 'onExportDocxAnnotated'],
    ['HTML, with comments', 'onExportAnnotated'],
  ] as const)('runs %s and closes', async (label, handler) => {
    const handlers = setup()
    await handlers.user.click(trigger())
    await handlers.user.click(screen.getByRole('menuitem', { name: new RegExp(`^${label}`) }))

    expect(handlers[handler]).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('runs the plain Word export without the annotated one', async () => {
    const { user, onExportDocx, onExportDocxAnnotated } = setup()
    await user.click(trigger())
    // Exact name, or the "with comments" item matches the same prefix.
    await user.click(screen.getByRole('menuitem', { name: /^Word A \.docx/ }))

    expect(onExportDocx).toHaveBeenCalledTimes(1)
    expect(onExportDocxAnnotated).not.toHaveBeenCalled()
  })

  it('closes on Escape without exporting anything', async () => {
    const handlers = setup()
    await handlers.user.click(trigger())
    await handlers.user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(handlers.onExport).not.toHaveBeenCalled()
    expect(handlers.onExportDocx).not.toHaveBeenCalled()
  })

  it('disables export and import together with the editor', () => {
    setup({ disabled: true })

    expect(trigger().hasAttribute('disabled')).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Import' }).hasAttribute('disabled'),
    ).toBe(true)
  })
})
