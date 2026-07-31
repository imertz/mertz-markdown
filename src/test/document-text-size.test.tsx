import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentTextSizeMenu } from '../components/DocumentTextSizeMenu'
import {
  DOCUMENT_TEXT_SIZE_KEY,
  useDocumentTextSize,
} from '../hooks/useDocumentTextSize'

afterEach(() => {
  cleanup()
  localStorage.clear()
  delete document.documentElement.dataset.documentTextSize
})

function PreferenceProbe() {
  const { size, selectSize } = useDocumentTextSize()
  return (
    <>
      <output>{size}</output>
      <button type="button" onClick={() => selectSize('extra-large')}>
        Use extra large
      </button>
    </>
  )
}

describe('document text-size preference', () => {
  it('falls back to Comfortable for an invalid stored value', () => {
    localStorage.setItem(DOCUMENT_TEXT_SIZE_KEY, 'not-a-size')
    render(<PreferenceProbe />)

    expect(screen.getByText('default')).toBeTruthy()
    expect(document.documentElement.dataset.documentTextSize).toBe('default')
  })

  it('restores a valid stored size', () => {
    localStorage.setItem(DOCUMENT_TEXT_SIZE_KEY, 'large')
    render(<PreferenceProbe />)

    expect(screen.getByText('large')).toBeTruthy()
    expect(document.documentElement.dataset.documentTextSize).toBe('large')
  })

  it('applies and persists a selection', async () => {
    const user = userEvent.setup()
    render(<PreferenceProbe />)

    await user.click(screen.getByRole('button', { name: 'Use extra large' }))

    expect(screen.getByText('extra-large')).toBeTruthy()
    expect(document.documentElement.dataset.documentTextSize).toBe('extra-large')
    expect(localStorage.getItem(DOCUMENT_TEXT_SIZE_KEY)).toBe('extra-large')
  })
})

describe('document text-size menu', () => {
  it('shows the reading scales and selects one', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { rerender } = render(
      <DocumentTextSizeMenu size="default" onSelect={onSelect} />,
    )

    await user.click(screen.getByRole('button', { name: /text size/i }))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(4)
    expect(
      screen.getByRole('menuitemradio', { name: /comfortable/i }),
    ).toBeTruthy()
    expect(screen.getByText('100% reading scale')).toBeTruthy()

    await user.click(screen.getByRole('menuitemradio', { name: /extra large/i }))
    expect(onSelect).toHaveBeenCalledWith('extra-large')
    expect(screen.queryByRole('menu')).toBeNull()

    rerender(<DocumentTextSizeMenu size="extra-large" onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: /extra large/i }))
    expect(
      screen
        .getByRole('menuitemradio', { name: /extra large/i })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<DocumentTextSizeMenu size="default" onSelect={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /text size/i }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
  })
})
