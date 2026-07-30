import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseChord } from '../keys/chord'
import { firesIn, scopeOf } from '../keys/scope'

/**
 * The guard is what makes `?` bindable at all, so both halves matter: a bare
 * key must be inert while the reader is typing, and a ⌘ chord must still work
 * there — nobody wants to leave the editor to save.
 */

function keydownOn(target: Element): KeyboardEvent {
  return { target } as unknown as KeyboardEvent
}

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  root.innerHTML = `
    <div class="ProseMirror" contenteditable="true"><p id="para">text</p></div>
    <div data-keys="overlay"><input id="overlay-input" /></div>
    <input id="bare-input" />
    <div id="note" contenteditable="true"></div>
    <button id="button">Bold</button>
  `
  document.body.append(root)
})

afterEach(() => {
  root.remove()
})

const at = (id: string) => root.querySelector(`#${id}`) as Element

describe('scopeOf', () => {
  it('classifies the editor surface, including nodes inside it', () => {
    expect(scopeOf(keydownOn(at('para')))).toBe('editor')
    expect(
      scopeOf(keydownOn(root.querySelector('.ProseMirror') as Element)),
    ).toBe('editor')
  })

  it('classifies anything marked as an overlay, even its inner field', () => {
    expect(scopeOf(keydownOn(at('overlay-input')))).toBe('overlay')
  })

  it('classifies ordinary text fields', () => {
    expect(scopeOf(keydownOn(at('bare-input')))).toBe('field')
  })

  it('classifies a contenteditable outside the editor as a field', () => {
    // Not the document surface, so it gets a field's protection rather than
    // the editor's looser rule.
    expect(scopeOf(keydownOn(at('note')))).toBe('field')
  })

  it('classifies everything else as app scope', () => {
    expect(scopeOf(keydownOn(at('button')))).toBe('app')
    expect(scopeOf(keydownOn(document.body))).toBe('app')
  })
})

describe('firesIn', () => {
  const bare = parseChord('shift+/')
  const modified = parseChord('mod+s')
  const alted = parseChord('alt+m')

  it('lets a bare key fire from the page but not while typing', () => {
    expect(firesIn(bare, 'app')).toBe(true)
    expect(firesIn(bare, 'editor')).toBe(false)
  })

  it('lets a modified chord fire while typing in the editor', () => {
    expect(firesIn(modified, 'editor')).toBe(true)
    expect(firesIn(alted, 'editor')).toBe(true)
  })

  it('blocks everything inside a field or an overlay', () => {
    for (const chord of [bare, modified, alted]) {
      expect(firesIn(chord, 'field')).toBe(false)
      expect(firesIn(chord, 'overlay')).toBe(false)
    }
  })
})
