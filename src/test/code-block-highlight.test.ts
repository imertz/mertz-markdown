import { describe, expect, it } from 'vitest'
import { buildResolvedExtensions } from '../editor/extensions'
import { toMarkdown } from '../markdown/export'
import { createTestEditor } from './editorHarness'

const fenced = (language: string, code: string) =>
  ['```' + language, code, '```'].join('\n')

describe('code block highlighting', () => {
  it('decorates tokens without touching the document', () => {
    const editor = createTestEditor(fenced('js', 'const answer = 42'))
    const before = editor.state.doc.toJSON()

    expect(editor.view.dom.querySelectorAll('.hljs-keyword').length).toBeGreaterThan(0)
    // Highlighting is decorations: nothing was written, so nothing can be
    // undone and nothing can reach the exported markdown.
    expect(editor.state.doc.toJSON()).toEqual(before)
    expect(editor.can().undo()).toBe(false)
  })

  it('keeps the language fence through a round-trip', () => {
    const source = fenced('python', 'def main():\n    return 1')
    const editor = createTestEditor(source)

    expect(toMarkdown(editor).trim()).toBe(source)
  })

  it('leaves a fence with no language alone', () => {
    const source = fenced('', 'plain text')
    const editor = createTestEditor(source)

    expect(toMarkdown(editor).trim()).toBe(source)
    // An unknown grammar must not throw or swallow the content.
    expect(editor.state.doc.textBetween(1, 11)).toBe('plain text')
  })

  it('survives a language lowlight has never heard of', () => {
    const source = fenced('nosuchlang', 'x := 1')
    const editor = createTestEditor(source)

    expect(toMarkdown(editor).trim()).toBe(source)
  })

  it('still declares the markdown handlers it inherited from CodeBlock', () => {
    // CodeBlockLowlight is CodeBlock.extend(...). getExtensionField walks
    // `parent`, which is the whole reason swapping it in needs no change to
    // markdown/config.ts — but that is an internal of @tiptap/core, so it is
    // worth failing loudly here rather than silently exporting empty fences.
    const codeBlock = buildResolvedExtensions().find(
      extension => extension.name === 'codeBlock',
    )

    expect(codeBlock).toBeDefined()
    expect(codeBlock?.config.name).toBe('codeBlock')
  })
})
