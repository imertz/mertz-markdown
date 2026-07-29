import { describe, expect, it } from 'vitest'
import { formatShortcut } from '../lib/shortcuts'

/**
 * Every binding is registered as `mod`, which is ⌘ or Ctrl depending on the
 * keyboard in front of the reader. These tests pin both spellings of the same
 * chord, since a hint that names the wrong key is worse than no hint.
 */

describe('formatShortcut', () => {
  it('spells a chord as Apple glyphs, unseparated', () => {
    expect(formatShortcut('mod+alt+shift+down', true)).toBe('⌘⌥⇧↓')
    expect(formatShortcut('mod+f', true)).toBe('⌘F')
    expect(formatShortcut('mod+enter', true)).toBe('⌘⏎')
  })

  it('spells the same chord as plus-joined words elsewhere', () => {
    expect(formatShortcut('mod+alt+shift+down', false)).toBe(
      'Ctrl+Alt+Shift+↓',
    )
    expect(formatShortcut('mod+f', false)).toBe('Ctrl+F')
    expect(formatShortcut('mod+enter', false)).toBe('Ctrl+Enter')
  })

  it('keeps arrow glyphs on both platforms', () => {
    // Every keyboard prints the arrows on the keycap, so spelling them out
    // would be less recognisable, not more.
    expect(formatShortcut('mod+alt+up', false)).toBe('Ctrl+Alt+↑')
    expect(formatShortcut('mod+alt+up', true)).toBe('⌘⌥↑')
  })

  it('prints modifiers in a fixed order whatever the spec says', () => {
    // Two call sites naming the same chord differently must not produce two
    // different hints.
    expect(formatShortcut('shift+alt+mod+z', true)).toBe(
      formatShortcut('mod+alt+shift+z', true),
    )
  })

  it('handles a bare key with no modifiers', () => {
    expect(formatShortcut('enter', true)).toBe('⏎')
    expect(formatShortcut('enter', false)).toBe('Enter')
  })
})
