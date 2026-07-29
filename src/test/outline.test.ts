import { describe, expect, it } from 'vitest'
import {
  activeHeadingIndex,
  caretFor,
  collectOutline,
  stepHeading,
} from '../editor/outline'
import { createTestEditor, rangeOfText } from './editorHarness'

/**
 * Backs the status bar's section navigation. The rules worth pinning down are
 * the two that are not obvious: the caret can sit *above* the first heading,
 * which is a real position rather than "section 0"; and stepping backwards from
 * mid-section lands on the current heading before leaving it.
 */

const DOC = [
  '# Field Guide',
  '',
  'An opening paragraph.',
  '',
  '## Installation',
  '',
  'Run the installer.',
  '',
  '### Prerequisites',
  '',
  'You will need a machine.',
  '',
  '## Rollout',
  '',
  'Ship it carefully.',
  '',
].join('\n')

const outlineOf = (markdown: string) => {
  const editor = createTestEditor(markdown)
  const outline = collectOutline(editor.state.doc)
  return { editor, outline }
}

describe('collectOutline', () => {
  it('lists every heading in document order with its level', () => {
    const { editor, outline } = outlineOf(DOC)

    expect(outline.map(entry => [entry.text, entry.level])).toEqual([
      ['Field Guide', 1],
      ['Installation', 2],
      ['Prerequisites', 3],
      ['Rollout', 2],
    ])

    editor.destroy()
  })

  it('is empty for a document with no headings', () => {
    const { editor, outline } = outlineOf('Just prose, no structure at all.\n')

    expect(outline).toEqual([])

    editor.destroy()
  })

  it('reports positions that put the caret inside the heading', () => {
    const { editor, outline } = outlineOf(DOC)

    const installation = outline[1]
    editor.commands.setTextSelection(caretFor(installation))

    // Resolving the caret should land in the heading node itself.
    expect(editor.state.selection.$from.parent.type.name).toBe('heading')
    expect(editor.state.selection.$from.parent.textContent).toBe('Installation')

    editor.destroy()
  })
})

describe('activeHeadingIndex', () => {
  it('is -1 above the first heading', () => {
    const { editor, outline } = outlineOf(DOC)

    expect(activeHeadingIndex(outline, 0)).toBe(-1)

    editor.destroy()
  })

  it('reports the heading the caret is inside', () => {
    const { editor, outline } = outlineOf(DOC)

    expect(activeHeadingIndex(outline, caretFor(outline[2]))).toBe(2)

    editor.destroy()
  })

  it('reports the enclosing section from body text', () => {
    const { editor, outline } = outlineOf(DOC)
    const body = rangeOfText(editor, 'Run the installer')

    expect(activeHeadingIndex(outline, body.from)).toBe(1)

    editor.destroy()
  })
})

describe('stepHeading', () => {
  it('walks forward through the headings', () => {
    const { editor, outline } = outlineOf(DOC)

    let caret = 0
    const visited: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const next = stepHeading(outline, caret, 1)
      if (!next) break
      visited.push(next.text)
      caret = caretFor(next)
    }

    expect(visited).toEqual([
      'Field Guide',
      'Installation',
      'Prerequisites',
      'Rollout',
    ])

    editor.destroy()
  })

  it('clamps at the last heading instead of wrapping', () => {
    // Unlike the comment chip, which cycles. Wrapping here would misreport
    // where you are in the document.
    const { editor, outline } = outlineOf(DOC)

    expect(stepHeading(outline, caretFor(outline[3]), 1)).toBeNull()

    editor.destroy()
  })

  it('clamps above the first heading instead of wrapping', () => {
    const { editor, outline } = outlineOf(DOC)

    expect(stepHeading(outline, 0, -1)).toBeNull()

    editor.destroy()
  })

  it('goes to the current heading first when stepping back mid-section', () => {
    const { editor, outline } = outlineOf(DOC)
    const body = rangeOfText(editor, 'You will need a machine')

    const first = stepHeading(outline, body.from, -1)
    expect(first?.text).toBe('Prerequisites')

    // Only once the caret is on that heading does another press leave it.
    const second = stepHeading(outline, caretFor(first!), -1)
    expect(second?.text).toBe('Installation')

    editor.destroy()
  })

  it('does nothing in a document with no headings', () => {
    const { editor, outline } = outlineOf('Prose only.\n')

    expect(stepHeading(outline, 1, 1)).toBeNull()
    expect(stepHeading(outline, 1, -1)).toBeNull()

    editor.destroy()
  })
})
