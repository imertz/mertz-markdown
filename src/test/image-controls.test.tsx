import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ImageControls } from '../components/editor/ImageBubbleMenu'
import { createTestEditorFromJSON } from './editorHarness'

const setup = (attrs: Record<string, unknown> = {}) => {
  const editor = createTestEditorFromJSON({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'image',
            attrs: {
              src: 'https://example.com/a.png',
              alt: 'Old text',
              ...attrs,
            },
          },
        ],
      },
    ],
  })
  let pos = -1
  editor.state.doc.descendants((node, at) => {
    if (node.type.name === 'image') pos = at
  })
  editor.commands.setNodeSelection(pos)
  render(<ImageControls editor={editor} />)
  return { editor, user: userEvent.setup() }
}

afterEach(cleanup)

describe('image controls', () => {
  it('edits alternative text', async () => {
    const { editor, user } = setup()
    const input = screen.getByRole('textbox', { name: 'Alt text' })
    await user.clear(input)
    await user.type(input, 'New description')
    await user.tab()

    let alt = ''
    editor.state.doc.descendants(node => {
      if (node.type.name === 'image') alt = node.attrs.alt
    })
    expect(alt).toBe('New description')
  })

  it('deletes the selected image', async () => {
    const { editor, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Delete image' }))

    expect(editor.getJSON().content?.[0]?.content).toBeUndefined()
  })

  it('sets an exact width without changing the aspect ratio', async () => {
    const { editor, user } = setup({ width: 400, height: 200 })
    const input = screen.getByRole('spinbutton', {
      name: 'Image width in pixels',
    })
    await user.clear(input)
    await user.type(input, '300')
    await user.tab()

    let dimensions: { width: number; height: number } | null = null
    editor.state.doc.descendants(node => {
      if (node.type.name === 'image') {
        dimensions = { width: node.attrs.width, height: node.attrs.height }
      }
    })
    expect(dimensions).toEqual({ width: 300, height: 150 })
  })

  it('resets an image to its natural size', async () => {
    const { editor, user } = setup({ width: 400, height: 200 })
    await user.click(screen.getByRole('button', { name: 'Natural' }))

    let dimensions: { width: number | null; height: number | null } | null = null
    editor.state.doc.descendants(node => {
      if (node.type.name === 'image') {
        dimensions = { width: node.attrs.width, height: node.attrs.height }
      }
    })
    expect(dimensions).toEqual({ width: null, height: null })
  })

  it('renders four aspect-locked resize handles', () => {
    const { editor } = setup({ width: 400, height: 200 })
    expect(
      editor.view.dom.querySelectorAll('[data-resize-handle]'),
    ).toHaveLength(4)
  })
})
