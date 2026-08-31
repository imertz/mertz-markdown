import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  insertMermaidBlock,
  MERMAID_LANGUAGE,
  resetMermaidCache,
} from '../editor/extensions/mermaid'
import { toMarkdown } from '../markdown/export'
import { toAnnotatedHtml } from '../markdown/exportHtml'
import { createTestEditor } from './editorHarness'

/**
 * The whole feature is a picture drawn beside a code block, so these are the
 * assertions that keep it a picture: the fence is untouched in both
 * directions, the render never lands in the document, and a diagram that will
 * not draw leaves its source on screen rather than vanishing.
 */

/*
 * The real mermaid is several megabytes of graph layout that needs a
 * measurable DOM, and none of it is under test here — what is under test is
 * everything around it. So the module is a stub that answers instantly, fails
 * predictably, and records what it was asked to draw.
 */
const rendered: string[] = []

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string, source: string) => {
      rendered.push(source)
      if (source.includes('boom')) throw new Error('Parse error on line 1\nboom')
      return { svg: `<svg data-id="${id}"><title>${source}</title></svg>` }
    }),
  },
}))

const fence = (source: string) =>
  ['```' + MERMAID_LANGUAGE, source, '```'].join('\n')

const DIAGRAM = 'flowchart TD\n  A --> B'

/** Let the render debounce elapse and the render promise settle. */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(400)
  await vi.advanceTimersByTimeAsync(0)
}

const preOf = (editor: { view: { dom: Element } }) =>
  editor.view.dom.querySelector('pre')

/** Position of the one mermaid code block in the document. */
function fencePos(editor: Editor): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock' && node.attrs.language === MERMAID_LANGUAGE) {
      found = pos
    }
  })
  if (found === -1) throw new Error('No mermaid fence in the document')
  return found
}

beforeEach(() => {
  rendered.length = 0
  resetMermaidCache()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mermaid fences', () => {
  it('round-trips the fence exactly', async () => {
    const source = fence(DIAGRAM)
    const editor = createTestEditor(source)
    await settle()

    expect(toMarkdown(editor).trim()).toBe(source)
  })

  it('draws the diagram without touching the document', async () => {
    const editor = createTestEditor(fence(DIAGRAM))
    /*
     * The trailing paragraph the schema adds after a block that is not one
     * arrives on the first transaction of any kind — in the app that is the
     * setContent which loads the document, long before any of this runs. Get
     * it out of the way here so that what is measured below is the render and
     * nothing else.
     */
    editor.view.dispatch(editor.state.tr)
    const before = editor.state.doc.toJSON()
    let updates = 0
    editor.on('update', () => {
      updates += 1
    })

    await settle()

    expect(editor.view.dom.querySelector('.mermaid-diagram svg')).not.toBeNull()
    // The render is a decoration: it did not write, so there is nothing to
    // undo, nothing to export and — the one that would actually hurt —
    // nothing for the autosave to pick up. No update event, no write.
    expect(editor.state.doc.toJSON()).toEqual(before)
    expect(updates).toBe(0)
  })

  it('hands mermaid the fence contents and nothing else', async () => {
    const editor = createTestEditor(fence(DIAGRAM))
    await settle()

    expect(rendered).toEqual([DIAGRAM])
    expect(editor.isDestroyed).toBe(false)
  })

  it('leaves a plain code block alone', async () => {
    const editor = createTestEditor(['```js', 'const a = 1', '```'].join('\n'))
    await settle()

    expect(rendered).toEqual([])
    expect(editor.view.dom.querySelector('.mermaid-diagram')).toBeNull()
    expect(preOf(editor)?.className ?? '').not.toContain('mermaid')
  })

  it('renders once for a source it has already drawn', async () => {
    createTestEditor(fence(DIAGRAM))
    await settle()
    const second = createTestEditor(fence(DIAGRAM))
    await settle()

    expect(rendered).toEqual([DIAGRAM])
    expect(second.view.dom.querySelector('.mermaid-diagram svg')).not.toBeNull()
  })
})

describe('the collapsed fence', () => {
  it('stands aside once there is a diagram to stand in for it', async () => {
    const editor = createTestEditor(`text\n\n${fence(DIAGRAM)}`)
    await settle()

    expect(preOf(editor)?.className).toContain('is-mermaid-rendered')
    expect(preOf(editor)?.className).not.toContain('is-mermaid-editing')
  })

  it('comes back the moment the caret is inside it', async () => {
    const editor = createTestEditor(`text\n\n${fence(DIAGRAM)}`)
    await settle()

    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.near(editor.state.doc.resolve(fencePos(editor) + 1)),
      ),
    )

    expect(preOf(editor)?.className).toContain('is-mermaid-editing')
  })

  it('stays on screen while the diagram is still being drawn', () => {
    const editor = createTestEditor(fence(DIAGRAM))

    // No settle: the render has been queued and has not come back. A block
    // that hid itself here would spend the first moments of its life invisible.
    expect(preOf(editor)?.className).not.toContain('is-mermaid-rendered')
    expect(editor.view.dom.querySelector('.mermaid-diagram')).toBeNull()
  })

  it('stays on screen when the diagram cannot be drawn', async () => {
    const editor = createTestEditor(fence('boom --> nowhere'))
    await settle()

    expect(preOf(editor)?.className).not.toContain('is-mermaid-rendered')
    const error = editor.view.dom.querySelector('.mermaid-diagram--error')
    // The first line only: mermaid's parse errors carry a copy of the source
    // underneath, which is already on screen.
    expect(error?.textContent).toBe('Parse error on line 1')
  })

  it('stays on screen for an empty fence', async () => {
    const editor = createTestEditor(fence(''))
    await settle()

    expect(rendered).toEqual([])
    expect(preOf(editor)?.className).not.toContain('is-mermaid-rendered')
  })
})

describe('inserting a diagram', () => {
  it('writes a fence that round-trips as ordinary GFM', async () => {
    const editor = createTestEditor('')
    insertMermaidBlock(editor)
    await settle()

    const markdown = toMarkdown(editor).trim()
    expect(markdown.startsWith('```mermaid\n')).toBe(true)
    expect(markdown.endsWith('```')).toBe(true)

    // Re-parsing what was written must land on the same document, or the
    // starter diagram is a thing the app can create but not reopen.
    const reopened = createTestEditor(markdown)
    expect(toMarkdown(reopened).trim()).toBe(markdown)
  })

  it('produces something mermaid can actually draw', async () => {
    const editor = createTestEditor('')
    insertMermaidBlock(editor)
    await settle()

    expect(editor.view.dom.querySelector('.mermaid-diagram--error')).toBeNull()
    expect(editor.view.dom.querySelector('.mermaid-diagram svg')).not.toBeNull()
  })
})

describe('the annotated HTML export', () => {
  const exported = (editor: Editor) =>
    toAnnotatedHtml(editor, { title: 'Doc', threads: [] })

  it('draws the diagram into the file', async () => {
    const editor = createTestEditor(fence(DIAGRAM))
    const html = await exported(editor)

    expect(html).toContain('class="mermaid-figure"')
    expect(html).toContain('<svg')
    // The fence itself is gone: this export exists to be read, and the
    // picture is what the source was for.
    expect(html).not.toContain('data-language="mermaid"')
  })

  it('keeps the fence when the diagram will not draw', async () => {
    const editor = createTestEditor(fence('boom --> nowhere'))
    const html = await exported(editor)

    // The stylesheet always carries the figure rules; what must be absent is
    // a figure using them.
    expect(html).not.toContain('<figure class="mermaid-figure">')
    // Losing the source to a failed render would be strictly worse than an
    // export that shows the code, which is what a plain reader shows anyway.
    expect(html).toContain('boom --&gt; nowhere')
  })

  it('leaves the markdown export alone', async () => {
    const source = fence(DIAGRAM)
    const editor = createTestEditor(source)
    await exported(editor)

    // Serializing to HTML must not have disturbed the document behind it.
    expect(toMarkdown(editor).trim()).toBe(source)
  })
})
