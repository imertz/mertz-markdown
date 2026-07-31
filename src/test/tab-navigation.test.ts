import { afterEach, describe, expect, it } from 'vitest'
import { toMarkdown } from '../markdown/export'
import { createTestEditor } from './editorHarness'

let editor: ReturnType<typeof createTestEditor> | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('editor Tab navigation', () => {
  it('consumes Tab in a paragraph and inserts a two-space indent', () => {
    editor = createTestEditor('hello')
    editor.commands.focus('end')

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    editor.view.dom.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(editor.getText()).toBe('hello  ')
  })

  it('removes the inserted indent with Shift-Tab', () => {
    editor = createTestEditor('hello  ')
    editor.commands.focus('end')

    editor.commands.keyboardShortcut('Shift-Tab')

    expect(editor.getText()).toBe('hello')
  })

  it('keeps list Tab available for nesting instead of inserting spaces', () => {
    editor = createTestEditor('- first\n- second')
    editor.commands.focus('end')

    editor.commands.keyboardShortcut('Tab')

    expect(toMarkdown(editor)).toContain('  - second')
  })
})
