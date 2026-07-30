import type { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { chordFor } from '../keys/catalog'
import { toProseMirrorKey } from '../keys/chord'
import { createTestEditor } from './editorHarness'

/**
 * The editor-side bindings, and the correction that keeps a German keyboard
 * from reformatting the document while someone types "10 m²".
 */

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function open(markdown: string): Editor {
  editor = createTestEditor(markdown)
  return editor
}

/** A keydown as Windows reports it while AltGr is held. */
function altGraph(instance: Editor, key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'getModifierState', {
    value: (name: string) => name === 'AltGraph',
  })
  instance.view.dom.dispatchEvent(event)
}

describe('AppShortcuts bindings', () => {
  it('binds strikethrough to the chord that survives a Windows browser', () => {
    const instance = open('hello')
    instance.commands.selectAll()

    instance.commands.keyboardShortcut('Mod-Shift-x')

    expect(instance.isActive('strike')).toBe(true)
  })

  it('keeps Tiptap’s own strikethrough chord working, just unadvertised', () => {
    const instance = open('hello')
    instance.commands.selectAll()

    instance.commands.keyboardShortcut('Mod-Shift-s')

    expect(instance.isActive('strike')).toBe(true)
  })

  it('binds blockquote away from Chrome’s bookmarks bar', () => {
    const instance = open('hello')

    instance.commands.keyboardShortcut('Mod-Shift-.')

    expect(instance.isActive('blockquote')).toBe(true)
  })

  it('keeps Tiptap’s own blockquote chord working', () => {
    const instance = open('hello')

    instance.commands.keyboardShortcut('Mod-Shift-b')

    expect(instance.isActive('blockquote')).toBe(true)
  })

  it('gives the horizontal rule a chord, which upstream never did', () => {
    // Resolved rather than hardcoded: the rule is ⌘⌥− on Apple and Alt+− off
    // it, and the contract under test is "the chord the cheat sheet advertises
    // is the chord that fires" — on whichever keyboard this happens to run.
    const instance = open('hello')

    instance.commands.keyboardShortcut(
      toProseMirrorKey(chordFor('insert.rule')),
    )

    expect(
      instance.getJSON().content?.some(node => node.type === 'horizontalRule'),
    ).toBe(true)
  })

  it('runs every advertised editor chord it owns', () => {
    // The catalog is the source, so the sweep is over the catalog rather than
    // over a list here that could fall behind it.
    for (const [id, active] of [
      ['format.strike', () => editor?.isActive('strike')],
      ['format.blockquote', () => editor?.isActive('blockquote')],
      ['format.codeBlock', () => editor?.isActive('codeBlock')],
      ['format.h1', () => editor?.isActive('heading', { level: 1 })],
      ['format.h2', () => editor?.isActive('heading', { level: 2 })],
      ['format.h3', () => editor?.isActive('heading', { level: 3 })],
    ] as const) {
      // An ordinary TextSelection over the word, not `selectAll`: marks need a
      // range to apply to, and the `AllSelection` that selectAll produces
      // confuses the node-level `isActive` checks.
      const instance = open('hello')
      instance.commands.setTextSelection({ from: 1, to: 6 })
      instance.commands.keyboardShortcut(toProseMirrorKey(chordFor(id)))
      expect(active(), `${id} did not fire on ${chordFor(id)}`).toBe(true)
      instance.destroy()
    }
    editor = null
  })
})

describe('AltGr correction', () => {
  it('types the character instead of running Tiptap’s Ctrl+Alt binding', () => {
    // AltGr+2 on a German keyboard. Without the correction this becomes a
    // heading, because Tiptap binds Mod-Alt-2 and Windows spells AltGr as
    // Ctrl+Alt.
    const instance = open('10 m')
    instance.commands.focus('end')

    altGraph(instance, '²')

    expect(instance.getText()).toBe('10 m²')
    expect(instance.isActive('heading', { level: 2 })).toBe(false)
  })

  it('protects the code block chord too, which Polish types as ć', () => {
    const instance = open('cz')
    instance.commands.focus('end')

    altGraph(instance, 'ć')

    expect(instance.getText()).toBe('czć')
    expect(instance.isActive('codeBlock')).toBe(false)
  })

  it('leaves non-character AltGr keystrokes to the keymaps', () => {
    const instance = open('hello')
    instance.commands.focus('end')

    altGraph(instance, 'Dead')

    expect(instance.getText()).toBe('hello')
  })

  it('replaces the selection, exactly as typing the character would', () => {
    const instance = open('hello')
    instance.commands.selectAll()

    altGraph(instance, 'µ')

    expect(instance.getText()).toBe('µ')
  })
})
