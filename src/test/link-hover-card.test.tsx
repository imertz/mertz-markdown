import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LinkHoverCard } from '../components/editor/LinkHoverCard'
import { toMarkdown } from '../markdown/export'
import { createTestEditor, rangeOfText } from './editorHarness'

afterEach(cleanup)

/** Mirrors HIDE_DELAY_MS in LinkHoverCard.tsx. */
const HIDE_DELAY_MS = 200

const setup = (markdown = 'see [the docs](https://example.dev) now') => {
  const editor = createTestEditor(markdown)
  const onEdit = vi.fn()
  render(<LinkHoverCard editor={editor} suppressed={false} onEdit={onEdit} />)

  const anchor = editor.view.dom.querySelector('a') as HTMLAnchorElement
  return { editor, onEdit, anchor, user: userEvent.setup() }
}

const card = () => screen.queryByRole('dialog', { name: 'Link preview' })

describe('LinkHoverCard', () => {
  it('is hidden until a link is hovered', () => {
    setup()
    expect(card()).toBeNull()
  })

  it('shows the href when a link is hovered', () => {
    const { anchor } = setup()
    fireEvent.mouseOver(anchor)

    expect(card()).toBeTruthy()
    expect(screen.getByTitle('https://example.dev')).toBeTruthy()
  })

  it('hides after the pointer leaves, once the grace period elapses', () => {
    vi.useFakeTimers()
    try {
      const { anchor } = setup()
      fireEvent.mouseOver(anchor)
      fireEvent.mouseOut(anchor, { relatedTarget: document.body })

      // Still up during the grace period — long enough to reach the card.
      expect(card()).toBeTruthy()

      act(() => {
        vi.advanceTimersByTime(HIDE_DELAY_MS)
      })
      expect(card()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not hide when the pointer crosses onto the card itself', () => {
    vi.useFakeTimers()
    try {
      const { anchor } = setup()
      fireEvent.mouseOver(anchor)
      fireEvent.mouseOut(anchor, { relatedTarget: card() })

      act(() => {
        vi.advanceTimersByTime(HIDE_DELAY_MS)
      })
      expect(card()).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows when the caret rests inside a link with nothing selected', () => {
    const { editor } = setup()
    const at = rangeOfText(editor, 'docs')

    act(() => {
      editor.commands.setTextSelection(at.from)
    })

    expect(card()).toBeTruthy()
    expect(screen.getByTitle('https://example.dev')).toBeTruthy()
  })

  it('hides once the selection grows past a bare caret', () => {
    const { editor } = setup()
    const at = rangeOfText(editor, 'docs')

    act(() => {
      editor.commands.setTextSelection(at.from)
    })
    expect(card()).toBeTruthy()

    act(() => {
      editor.commands.setTextSelection(rangeOfText(editor, 'the docs'))
    })
    expect(card()).toBeNull()
  })

  it('does not show anything while suppressed', () => {
    const editor = createTestEditor('see [the docs](https://example.dev) now')
    render(<LinkHoverCard editor={editor} suppressed onEdit={vi.fn()} />)

    const anchor = editor.view.dom.querySelector('a') as HTMLAnchorElement
    fireEvent.mouseOver(anchor)

    expect(card()).toBeNull()
  })

  it('hands Edit the link range and closes', async () => {
    const { anchor, onEdit, user } = setup()
    fireEvent.mouseOver(anchor)

    await user.click(screen.getByRole('button', { name: 'Edit link' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    const target = onEdit.mock.calls[0][0]
    expect(target.href).toBe('https://example.dev')
    expect(card()).toBeNull()
  })

  it('opens the href in a new tab', async () => {
    const { anchor, user } = setup()
    fireEvent.mouseOver(anchor)

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    await user.click(screen.getByRole('button', { name: 'Open link in a new tab' }))

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.dev',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })

  it('removes the link without touching its text', async () => {
    const { editor, anchor, user } = setup()
    fireEvent.mouseOver(anchor)

    await user.click(screen.getByRole('button', { name: 'Remove link' }))

    const markdown = toMarkdown(editor)
    expect(markdown).not.toContain('example.dev')
    expect(markdown).toContain('the docs')
    expect(card()).toBeNull()
  })
})
