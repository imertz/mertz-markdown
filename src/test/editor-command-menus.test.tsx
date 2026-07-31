import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlashCommandMenu } from '../components/editor/SlashCommandMenu'
import { createTestEditor } from './editorHarness'

afterEach(cleanup)

describe('SlashCommandMenu', () => {
  it('uses catalog labels and converts the active block', async () => {
    const editor = createTestEditor('')
    editor.commands.focus()
    editor.commands.insertContent('/')

    render(
      <SlashCommandMenu
        editor={editor}
        onAddComment={vi.fn()}
        onAddLink={vi.fn()}
        onInsertImages={vi.fn()}
      />,
    )

    expect(screen.getByRole('option', { name: /Heading 2/ })).toBeDefined()
    expect(screen.queryByRole('option', { name: /Insert template/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /Turn into/ })).toBeNull()
    await userEvent.setup().click(screen.getByRole('option', { name: /Heading 2/ }))

    await waitFor(() => {
      expect(editor.state.doc.firstChild?.type.name).toBe('heading')
      expect(editor.state.doc.firstChild?.attrs.level).toBe(2)
    })
    editor.destroy()
  })

  it('scrolls the active command into view while navigating', async () => {
    const editor = createTestEditor('')
    editor.commands.focus()
    editor.commands.insertContent('/')
    const user = userEvent.setup()
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')

    render(
      <SlashCommandMenu
        editor={editor}
        onAddComment={vi.fn()}
        onAddLink={vi.fn()}
        onInsertImages={vi.fn()}
      />,
    )

    for (let index = 0; index < 7; index += 1) {
      await user.keyboard('{ArrowDown}')
    }

    await waitFor(() =>
      expect(scrollIntoView.mock.calls.length).toBeGreaterThan(1),
    )
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })

    scrollIntoView.mockRestore()
    editor.destroy()
  })
})
