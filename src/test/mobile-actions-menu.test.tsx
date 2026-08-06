import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileActionsMenu } from '../components/MobileActionsMenu'
import { documentFonts } from '../hooks/useDocumentFont'
import { documentTextSizes } from '../hooks/useDocumentTextSize'
import { FORMATS } from '../components/documents/exportFormats'

afterEach(cleanup)

function renderMenu(overrides: Record<string, unknown> = {}) {
  const props = {
    exports: {
      onExport: vi.fn(),
      onExportDocx: vi.fn(),
      onExportDocxAnnotated: vi.fn(),
      onExportAnnotated: vi.fn(),
    },
    onImport: vi.fn(),
    onOpenHistory: vi.fn(),
    font: 'system' as const,
    onSelectFont: vi.fn(),
    textSize: 'default' as const,
    onSelectTextSize: vi.fn(),
    theme: 'light' as const,
    onToggleTheme: vi.fn(),
    ...overrides,
  }
  render(<MobileActionsMenu {...props} />)
  return props
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /more actions/i }))

describe('mobile actions menu', () => {
  it('carries every action the phone header cannot show', async () => {
    const user = userEvent.setup()
    renderMenu()
    await openMenu(user)

    // The sheet is built from the same arrays the desktop menus use, so this
    // fails the moment one of them grows an option the sheet does not offer.
    for (const format of FORMATS) {
      expect(screen.getByRole('menuitem', { name: format.label })).toBeTruthy()
    }
    for (const font of documentFonts) {
      expect(
        screen.getByRole('menuitemradio', { name: font.label }),
      ).toBeTruthy()
    }
    for (const size of documentTextSizes) {
      expect(
        screen.getByRole('menuitemradio', { name: size.label }),
      ).toBeTruthy()
    }
    expect(screen.getByRole('menuitem', { name: /import/i })).toBeTruthy()
    expect(
      screen.getByRole('menuitem', { name: /version history/i }),
    ).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /dark theme/i })).toBeTruthy()
  })

  it('runs an export and closes', async () => {
    const user = userEvent.setup()
    const props = renderMenu()
    await openMenu(user)

    await user.click(screen.getByRole('menuitem', { name: 'Word' }))

    expect(props.exports.onExportDocx).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('marks the active font and text size', async () => {
    const user = userEvent.setup()
    renderMenu({ font: 'literata', textSize: 'large' })
    await openMenu(user)

    expect(
      screen
        .getByRole('menuitemradio', { name: /literata/i })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(
      screen
        .getByRole('menuitemradio', { name: 'Large' })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('disables the actions that need a document when there is none', async () => {
    const user = userEvent.setup()
    renderMenu({ disabled: true })
    await openMenu(user)

    expect(
      screen.getByRole('menuitem', { name: 'Markdown' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen
        .getByRole('menuitem', { name: /version history/i })
        .hasAttribute('disabled'),
    ).toBe(true)
    // Reading preferences are not about the document and stay available.
    expect(
      screen
        .getByRole('menuitemradio', { name: 'Inter' })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    renderMenu()
    await openMenu(user)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
  })
})
