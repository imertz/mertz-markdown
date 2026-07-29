import { describe, expect, it } from 'vitest'
import {
  findMatches,
  getSearchState,
} from '../editor/extensions/search'
import { toMarkdown } from '../markdown/export'
import { createTestEditor, rangeOfText } from './editorHarness'

const textAt = (editor: ReturnType<typeof createTestEditor>) =>
  editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n')

describe('findMatches', () => {
  it('is case-insensitive and reports every occurrence in order', () => {
    const editor = createTestEditor('Alpha bravo ALPHA charlie alpha')
    const matches = findMatches(editor.state.doc, 'alpha')

    expect(matches).toHaveLength(3)
    expect(matches[0].from).toBeLessThan(matches[1].from)
    for (const match of matches) {
      expect(
        editor.state.doc.textBetween(match.from, match.to).toLowerCase(),
      ).toBe('alpha')
    }
  })

  it('finds a phrase that a comment mark has split across text nodes', () => {
    // Applying a mark splits the text node it covers, so "three four" stops
    // being a single node — which is exactly the case a naive per-node
    // indexOf misses.
    const editor = createTestEditor('one two three four five')
    editor.commands.setTextSelection(rangeOfText(editor, 'three'))
    editor.commands.setComment('thread-split')

    const matches = findMatches(editor.state.doc, 'three four')
    expect(matches).toHaveLength(1)
    expect(
      editor.state.doc.textBetween(matches[0].from, matches[0].to),
    ).toBe('three four')
  })

  it('does not run a match across a block boundary', () => {
    const editor = createTestEditor('ends here\n\nstarts there')
    expect(findMatches(editor.state.doc, 'here starts')).toEqual([])
  })

  it('counts overlapping candidates the way a find box does', () => {
    const editor = createTestEditor('aaaa')
    // "aa" in "aaaa" is two matches, not three.
    expect(findMatches(editor.state.doc, 'aa')).toHaveLength(2)
  })

  it('returns nothing for an empty query', () => {
    const editor = createTestEditor('anything at all')
    expect(findMatches(editor.state.doc, '')).toEqual([])
  })
})

describe('search state', () => {
  it('selects the first match when a query is set', () => {
    const editor = createTestEditor('one two three two one')
    editor.commands.setSearchQuery('two')

    const state = getSearchState(editor)
    expect(state.matches).toHaveLength(2)
    expect(state.activeIndex).toBe(0)
    // The active match is the selection, so closing the bar leaves the caret
    // where the user was looking.
    expect(editor.state.selection.from).toBe(state.matches[0].from)
  })

  it('wraps at both ends when stepping', () => {
    const editor = createTestEditor('go go go')
    editor.commands.setSearchQuery('go')
    expect(getSearchState(editor).activeIndex).toBe(0)

    editor.commands.stepSearchMatch(-1)
    expect(getSearchState(editor).activeIndex).toBe(2)

    editor.commands.stepSearchMatch(1)
    expect(getSearchState(editor).activeIndex).toBe(0)
  })

  it('re-scans when the document changes underneath it', () => {
    const editor = createTestEditor('needle and thread')
    editor.commands.setSearchQuery('needle')
    expect(getSearchState(editor).matches).toHaveLength(1)

    editor.commands.setTextSelection(rangeOfText(editor, 'needle'))
    editor.commands.insertContent('pin')

    expect(getSearchState(editor).matches).toEqual([])
    expect(getSearchState(editor).activeIndex).toBe(-1)
  })

  it('leaves the undo stack alone', () => {
    const editor = createTestEditor('searching changes nothing')
    const before = editor.state.doc.toJSON()

    editor.commands.setSearchQuery('changes')
    editor.commands.stepSearchMatch(1)

    expect(editor.state.doc.toJSON()).toEqual(before)
    expect(editor.can().undo()).toBe(false)
  })
})

describe('replace', () => {
  it('replaces only the active match', () => {
    const editor = createTestEditor('cat cat cat')
    editor.commands.setSearchQuery('cat')
    editor.commands.replaceSearchMatch('dog')

    expect(textAt(editor)).toBe('dog cat cat')
  })

  it('replaces every match in a single undo step', () => {
    const editor = createTestEditor('cat cat cat')
    const before = editor.state.doc.toJSON()

    editor.commands.setSearchQuery('cat')
    editor.commands.replaceAllSearchMatches('dog')
    expect(textAt(editor)).toBe('dog dog dog')

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('handles a replacement longer than what it replaces', () => {
    const editor = createTestEditor('a b a b a')
    editor.commands.setSearchQuery('a')
    editor.commands.replaceAllSearchMatches('xyz')

    expect(textAt(editor)).toBe('xyz b xyz b xyz')
  })

  it('keeps the formatting of the text it replaces', () => {
    const editor = createTestEditor('plain **bold** plain')
    editor.commands.setSearchQuery('bold')
    editor.commands.replaceSearchMatch('strong')

    expect(toMarkdown(editor)).toContain('**strong**')
  })

  it('is a no-op when there is nothing to replace', () => {
    const editor = createTestEditor('nothing here')
    editor.commands.setSearchQuery('missing')

    expect(editor.commands.replaceSearchMatch('x')).toBe(false)
    expect(editor.commands.replaceAllSearchMatches('x')).toBe(false)
    expect(textAt(editor)).toBe('nothing here')
  })
})
