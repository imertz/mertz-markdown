import { describe, expect, it } from 'vitest'
import { hrefAt, linkRangeAt, unlinkRange } from '../editor/linkActions'
import { toMarkdown } from '../markdown/export'
import { createTestEditor, rangeOfText } from './editorHarness'

describe('linkRangeAt', () => {
  it('finds the whole mark range and href from any position inside it', () => {
    const editor = createTestEditor('see [the docs](https://example.dev) now')
    // "docs" is a substring of the link text "the docs" — the range returned
    // must still cover the whole mark, not just the word resolved against.
    const at = rangeOfText(editor, 'docs')

    const found = linkRangeAt(editor.state, at.from)
    const full = rangeOfText(editor, 'the docs')

    expect(found?.href).toBe('https://example.dev')
    expect(found?.from).toBe(full.from)
    expect(found?.to).toBe(full.to)
  })

  it('returns null outside any link', () => {
    const editor = createTestEditor('see [the docs](https://example.dev) now')
    const at = rangeOfText(editor, 'see')
    expect(linkRangeAt(editor.state, at.from)).toBeNull()
  })
})

describe('hrefAt', () => {
  it('reads the href at a position inside a link', () => {
    const editor = createTestEditor('see [the docs](https://example.dev) now')
    const at = rangeOfText(editor, 'docs')
    expect(hrefAt(editor.state, at.from)).toBe('https://example.dev')
  })

  it('is empty outside any link', () => {
    const editor = createTestEditor('see [the docs](https://example.dev) now')
    const at = rangeOfText(editor, 'now')
    expect(hrefAt(editor.state, at.from)).toBe('')
  })
})

describe('unlinkRange', () => {
  it('removes the link mark without touching the text', () => {
    const editor = createTestEditor('see [the docs](https://example.dev) now')
    const range = rangeOfText(editor, 'the docs')

    unlinkRange(editor, range)

    const markdown = toMarkdown(editor)
    expect(markdown).not.toContain('example.dev')
    expect(markdown).toContain('the docs')
  })
})
