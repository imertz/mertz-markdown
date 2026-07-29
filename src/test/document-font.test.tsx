import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentFontMenu } from '../components/DocumentFontMenu'
import {
  DOCUMENT_FONT_KEY,
  useDocumentFont,
} from '../hooks/useDocumentFont'

afterEach(() => {
  cleanup()
  localStorage.clear()
  delete document.documentElement.dataset.documentFont
})

function PreferenceProbe() {
  const { font, selectFont } = useDocumentFont()
  return (
    <>
      <output>{font}</output>
      <button type="button" onClick={() => selectFont('literata')}>
        Use Literata
      </button>
    </>
  )
}

describe('document font preference', () => {
  it('falls back to System default for an invalid stored value', () => {
    localStorage.setItem(DOCUMENT_FONT_KEY, 'not-a-font')
    render(<PreferenceProbe />)

    expect(screen.getByText('system')).toBeTruthy()
    expect(document.documentElement.dataset.documentFont).toBe('system')
  })

  it('restores a valid stored font', () => {
    localStorage.setItem(DOCUMENT_FONT_KEY, 'fira-sans')
    render(<PreferenceProbe />)

    expect(screen.getByText('fira-sans')).toBeTruthy()
    expect(document.documentElement.dataset.documentFont).toBe('fira-sans')
  })

  it('applies and persists a selection', async () => {
    const user = userEvent.setup()
    render(<PreferenceProbe />)

    await user.click(screen.getByRole('button', { name: 'Use Literata' }))

    expect(screen.getByText('literata')).toBeTruthy()
    expect(document.documentElement.dataset.documentFont).toBe('literata')
    expect(localStorage.getItem(DOCUMENT_FONT_KEY)).toBe('literata')
  })
})

describe('document font menu', () => {
  it('previews Greek options, selects one, and closes', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { rerender } = render(
      <DocumentFontMenu font="system" onSelect={onSelect} />,
    )

    await user.click(screen.getByRole('button', { name: /reading font/i }))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(5)
    expect(screen.getAllByText('Καλημέρα · Greek notes')).toHaveLength(5)

    await user.click(screen.getByRole('menuitemradio', { name: /literata/i }))
    expect(onSelect).toHaveBeenCalledWith('literata')
    expect(screen.queryByRole('menu')).toBeNull()

    rerender(<DocumentFontMenu font="literata" onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: /reading font/i }))
    expect(
      screen
        .getByRole('menuitemradio', { name: /literata/i })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<DocumentFontMenu font="system" onSelect={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /reading font/i }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
  })
})
