import type { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { toMarkdown } from '../markdown/export'
import { createTestEditor } from './editorHarness'

/**
 * Simulate typing one character at a time through `handleTextInput`, which is
 * the hook input rules actually fire from — `insertContent` bypasses them, so
 * a test built on it would pass no matter what the rule does.
 */
function type(editor: Editor, text: string): void {
  for (const char of text) {
    if (char === '\n') {
      const split =
        editor.commands.splitListItem('taskItem') ||
        editor.commands.splitListItem('listItem')
      if (!split) editor.commands.splitBlock()
      continue
    }

    const { view } = editor
    const { from, to } = editor.state.selection
    const handled = view.someProp('handleTextInput', handler =>
      handler(view, from, to, char, () =>
        view.state.tr.insertText(char, from, to),
      ),
    )
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
  }
}

describe('task list shortcut', () => {
  it('turns "- [ ] " into a real task item, not literal brackets', () => {
    const editor = createTestEditor()
    type(editor, '- [ ] first task')

    const markdown = toMarkdown(editor)
    expect(markdown).toContain('- [ ] first task')
    // The bug this rule fixes: the marker surviving as escaped literal text.
    expect(markdown).not.toContain('\\[')
    editor.destroy()
  })

  it('honours "- [x] " as a checked item', () => {
    const editor = createTestEditor()
    type(editor, '- [x] done thing')

    expect(toMarkdown(editor)).toContain('- [x] done thing')
    editor.destroy()
  })

  it('leaves an ordinary bullet alone', () => {
    const editor = createTestEditor()
    type(editor, '- plain bullet')

    const markdown = toMarkdown(editor)
    expect(markdown).toContain('- plain bullet')
    expect(markdown).not.toContain('[ ]')
    editor.destroy()
  })

  it('still round-trips through markdown', () => {
    const editor = createTestEditor()
    type(editor, '- [ ] alpha')
    const once = toMarkdown(editor)

    const reloaded = createTestEditor(once)
    expect(toMarkdown(reloaded)).toBe(once)

    editor.destroy()
    reloaded.destroy()
  })
})
