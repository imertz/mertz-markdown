import { describe, expect, it } from 'vitest'
import { createTestEditor } from './editorHarness'

describe('paragraph alignment', () => {
  it('justifies the current paragraph and renders the alignment in HTML', () => {
    const editor = createTestEditor('A paragraph.')

    expect(editor.commands.setTextAlign('justify')).toBe(true)
    expect(editor.isActive('paragraph', { textAlign: 'justify' })).toBe(true)
    expect(editor.getHTML()).toContain(
      '<p style="text-align: justify;">A paragraph.</p>',
    )

    expect(editor.commands.unsetTextAlign()).toBe(true)
    expect(editor.isActive('paragraph', { textAlign: 'justify' })).toBe(false)
    expect(editor.getHTML()).toBe('<p>A paragraph.</p>')

    editor.destroy()
  })

  it('justifies selected paragraphs without changing headings', () => {
    const editor = createTestEditor('# Heading\n\nFirst.\n\nSecond.')
    editor.commands.selectAll()

    expect(editor.commands.setTextAlign('justify')).toBe(true)

    const content = editor.getJSON().content ?? []
    expect(content[0]?.attrs).not.toHaveProperty('textAlign', 'justify')
    expect(content[1]?.attrs).toMatchObject({ textAlign: 'justify' })
    expect(content[2]?.attrs).toMatchObject({ textAlign: 'justify' })

    editor.destroy()
  })
})
