import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FindBar } from '../components/editor/FindBar'
import { createTestEditor } from './editorHarness'

afterEach(cleanup)

const setup = (markdown: string) => {
  const editor = createTestEditor(markdown)
  const onClose = vi.fn()
  render(<FindBar editor={editor} focusRequest={0} onClose={onClose} />)
  return { editor, onClose, user: userEvent.setup() }
}

const findInput = () =>
  screen.getByLabelText('Find in document') as HTMLInputElement

const count = () => screen.getByRole('status').textContent

const textOf = (editor: ReturnType<typeof createTestEditor>) =>
  editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n')

describe('FindBar', () => {
  it('takes focus on mount and keeps it while the query is typed', async () => {
    const { user } = setup('one two three two one')
    expect(document.activeElement).toBe(findInput())

    // The whole query has to arrive. Every keystroke dispatches a transaction
    // that moves the editor selection onto the first match, and if that ever
    // pulled focus into the document only the first letter would land.
    await user.keyboard('two')
    expect(findInput().value).toBe('two')
    expect(document.activeElement).toBe(findInput())
  })

  it('reports the match count and steps through it with Enter', async () => {
    const { user } = setup('go go go')

    await user.keyboard('go')
    expect(count()).toBe('1 of 3')

    await user.keyboard('{Enter}')
    expect(count()).toBe('2 of 3')

    // Wraps backwards past the start rather than going dead.
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(count()).toBe('1 of 3')
  })

  it('says so when nothing matches, and disables the steppers', async () => {
    const { user } = setup('nothing to see')

    await user.keyboard('absent')
    expect(count()).toBe('No results')
    expect(
      (screen.getByLabelText('Next match') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('closes on Escape', async () => {
    const { user, onClose } = setup('anything')

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape from a button too, not only the fields', async () => {
    // Clicking a stepper or a replace button leaves focus on it, which is
    // exactly when someone reaches for Escape.
    const { user, onClose } = setup('go go go')

    await user.keyboard('go')
    await user.click(screen.getByLabelText('Next match'))
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('replaces every match from the replace row', async () => {
    const { user, editor } = setup('cat cat cat')

    await user.keyboard('cat')
    await user.click(screen.getByLabelText('Show replace'))
    await user.click(screen.getByLabelText('Replace with'))
    await user.keyboard('dog')
    await user.click(screen.getByRole('button', { name: 'All' }))

    expect(textOf(editor)).toBe('dog dog dog')
  })
})
