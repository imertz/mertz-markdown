import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentFontMenu } from '../components/DocumentFontMenu'
import {
  DOCUMENT_FONT_KEY,
  documentFonts,
  isDocumentFontId,
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

  it('restores every registered font, including the Greek-capable ones', () => {
    for (const option of documentFonts) {
      expect(isDocumentFontId(option.id)).toBe(true)
      expect(option.family).toBeTruthy()

      localStorage.setItem(DOCUMENT_FONT_KEY, option.id)
      const { unmount } = render(<PreferenceProbe />)
      expect(document.documentElement.dataset.documentFont).toBe(option.id)
      unmount()
    }
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
  it('offers every family, selects one, and closes', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { rerender } = render(
      <DocumentFontMenu font="system" onSelect={onSelect} />,
    )

    await user.click(screen.getByRole('button', { name: /reading font/i }))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(
      documentFonts.length,
    )
    /* The name is the only specimen now, so each one has to be there and has to
       be set in the face it names. The DOM re-serialises the stack with double
       quotes, so compare on normalised quoting rather than the raw string. */
    const quotes = (stack: string) => stack.replaceAll("'", '"')
    for (const option of documentFonts) {
      const item = screen.getByRole('menuitemradio', { name: option.label })
      expect(quotes(item.style.fontFamily)).toBe(quotes(option.family))
    }

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
