import { afterEach, describe, expect, it } from 'vitest'
import {
  findMatches,
  getSearchState,
  revealOffset,
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

interface Band {
  top: number
  bottom: number
}

describe('revealOffset', () => {
  const band: Band = { top: 100, bottom: 500 }

  it('is zero for a match already inside the band', () => {
    expect(revealOffset({ top: 200, bottom: 220 }, band)).toBe(0)
  })

  it('scrolls up by just enough to clear the top edge', () => {
    expect(revealOffset({ top: 60, bottom: 80 }, band)).toBe(-40)
  })

  it('scrolls down by just enough to clear the bottom edge', () => {
    expect(revealOffset({ top: 520, bottom: 540 }, band)).toBe(40)
  })

  it('aligns the top of a match too tall to fit', () => {
    // Pushing it up until its bottom cleared the band would take its start off
    // the screen, which is the part worth looking at.
    expect(revealOffset({ top: 200, bottom: 900 }, band)).toBe(100)
  })
})

/*
 * happy-dom lays nothing out, so the two rects a reveal reads are stubbed: the
 * scroll container is a fixed band, and the active highlight sits wherever the
 * test puts it.
 */
const SCROLLER: Band = { top: 0, bottom: 600 }
let activeMatch: Band = { top: 0, bottom: 0 }
const nativeRect = Element.prototype.getBoundingClientRect

const asRect = (band: Band): DOMRect =>
  ({
    ...band,
    height: band.bottom - band.top,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: band.top,
    toJSON: () => ({}),
  }) as DOMRect

/** The editor inside a stand-in for the app's scroll container. */
function mountInScroller(markdown: string) {
  const scroller = document.createElement('div')
  scroller.className = 'workspace'
  const host = document.createElement('div')
  scroller.append(host)
  document.body.append(scroller)

  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList.contains('workspace')) return asRect(SCROLLER)
    if (this.classList.contains('search-match--active')) {
      return asRect(activeMatch)
    }
    return asRect({ top: 0, bottom: 0 })
  }

  return { editor: createTestEditor(markdown, host), scroller }
}

afterEach(() => {
  Element.prototype.getBoundingClientRect = nativeRect
  document.body.replaceChildren()
})

/*
 * ProseMirror's own scrollIntoView is measured from the DOM selection, which
 * lives in the find bar's input for the whole time the bar is open — so it
 * silently does nothing, and stepping through matches used to leave the reader
 * looking at the same screenful. These cover the reveal that replaces it.
 */
describe('revealing the active match', () => {
  it('scrolls to the first hit when a query is set', () => {
    activeMatch = { top: 900, bottom: 920 }
    const { editor, scroller } = mountInScroller('needle in a stack')

    editor.commands.setSearchQuery('needle')

    // Bottom of the band is 600, less the 24px gap kept clear.
    expect(scroller.scrollTop).toBe(920 - 600 + 24)
  })

  it('scrolls to the next hit when stepping', () => {
    activeMatch = { top: 100, bottom: 120 }
    const { editor, scroller } = mountInScroller('go and go and go')
    editor.commands.setSearchQuery('go')
    expect(scroller.scrollTop).toBe(0)

    activeMatch = { top: 1400, bottom: 1420 }
    editor.commands.stepSearchMatch(1)

    expect(scroller.scrollTop).toBe(1420 - 600 + 24)
  })

  it('holds the page still for a hit that is already on screen', () => {
    activeMatch = { top: 100, bottom: 120 }
    const { editor, scroller } = mountInScroller('go and go and go')
    editor.commands.setSearchQuery('go')

    activeMatch = { top: 300, bottom: 320 }
    editor.commands.stepSearchMatch(1)

    expect(scroller.scrollTop).toBe(0)
  })

  it('scrolls back to a lone hit that has been scrolled away from', () => {
    activeMatch = { top: 100, bottom: 120 }
    const { editor, scroller } = mountInScroller('one needle only')
    editor.commands.setSearchQuery('needle')

    // Stepping with a single match lands on the same match, and Enter still
    // has to bring it back.
    activeMatch = { top: 900, bottom: 920 }
    editor.commands.stepSearchMatch(1)

    expect(scroller.scrollTop).toBe(920 - 600 + 24)
  })

  it('does not scroll when the document changes under an open search', () => {
    activeMatch = { top: 100, bottom: 120 }
    const { editor, scroller } = mountInScroller('needle and thread')
    editor.commands.setSearchQuery('needle')

    // Typing moves the caret, and the caret's own scroll is the one that
    // should answer for where the page goes.
    activeMatch = { top: 900, bottom: 920 }
    editor.commands.insertContentAt(editor.state.doc.content.size, ' more')

    expect(scroller.scrollTop).toBe(0)
  })
})
