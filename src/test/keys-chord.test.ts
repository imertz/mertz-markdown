import { describe, expect, it } from 'vitest'
import {
  chordSignature,
  matchesChord,
  parseChord,
  toProseMirrorKey,
  usesExactly,
} from '../keys/chord'

/**
 * The layout tests are the point of this file.
 *
 * A chord that matches on the wrong property of the event half-works: it fires
 * on the machine it was written on and dies silently on a French or German
 * keyboard, which is exactly the kind of bug that ships. Each case below is a
 * real `{ key, code }` pair as the browser reports it on that layout.
 */

interface PressInit {
  key: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  /** The right-Alt state Windows reports alongside its synthetic Ctrl+Alt. */
  altGraph?: boolean
}

function press({ altGraph = false, ...rest }: PressInit): KeyboardEvent {
  return {
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    getModifierState: (name: string) => name === 'AltGraph' && altGraph,
    ...rest,
  } as unknown as KeyboardEvent
}

describe('parseChord', () => {
  it('matches letters by character, so the mnemonic survives a relayout', () => {
    expect(parseChord('mod+e')).toEqual({
      key: 'e',
      mod: true,
      alt: false,
      shift: false,
    })
  })

  it('matches digits and punctuation by position', () => {
    expect(parseChord('mod+shift+8').code).toBe('Digit8')
    expect(parseChord('mod+shift+.').code).toBe('Period')
    expect(parseChord('mod+shift+]').code).toBe('BracketRight')
    expect(parseChord('mod+\\').code).toBe('Backslash')
    expect(parseChord('mod+alt+-').code).toBe('Minus')
  })

  it('resolves named keys to the value the browser reports', () => {
    expect(parseChord('mod+alt+up').key).toBe('arrowup')
    expect(parseChord('space').key).toBe(' ')
  })
})

describe('matchesChord — layouts', () => {
  it('matches a US shifted digit, where the character is not the digit', () => {
    // ⌘⇧8 on a US keyboard arrives as '*'.
    expect(
      matchesChord(
        parseChord('mod+shift+8'),
        press({ key: '*', code: 'Digit8', metaKey: true, shiftKey: true }),
      ),
    ).toBe(true)
  })

  it('matches US shifted punctuation', () => {
    expect(
      matchesChord(
        parseChord('mod+shift+.'),
        press({ key: '>', code: 'Period', metaKey: true, shiftKey: true }),
      ),
    ).toBe(true)
    expect(
      matchesChord(
        parseChord('mod+shift+]'),
        press({
          key: '}',
          code: 'BracketRight',
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(true)
  })

  it('matches an AZERTY digit, where the digit row is shifted by default', () => {
    // The physical `1` produces '&' unshifted on AZERTY, so `key` would never
    // match a shift-less binding. Position is the only thing that works.
    expect(
      matchesChord(
        parseChord('mod+1'),
        press({ key: '&', code: 'Digit1', metaKey: true }),
      ),
    ).toBe(true)
  })

  it('ignores position for letters, so Dvorak keeps the mnemonic', () => {
    // The key printed 'E' on a Dvorak keyboard sits where QWERTY prints 'D'.
    expect(
      matchesChord(
        parseChord('mod+e'),
        press({ key: 'e', code: 'KeyD', metaKey: true }),
      ),
    ).toBe(true)
  })

  it('still matches an event carrying no code at all', () => {
    expect(
      matchesChord(
        parseChord('mod+shift+8'),
        press({ key: '8', metaKey: true, shiftKey: true }),
      ),
    ).toBe(true)
  })
})

describe('matchesChord — shifted characters', () => {
  it('matches `?` by the character, on whatever key makes it', () => {
    /*
     * There is no `?` keycap to aim at: it is Shift+/ on a US keyboard and
     * Shift+ß on a German one. Matching position would find one of them and
     * miss the other, so the character is what is compared and Shift — which
     * is how the character was made — is not compared at all.
     */
    const chord = parseChord('?')

    expect(
      matchesChord(chord, press({ key: '?', code: 'Slash', shiftKey: true })),
    ).toBe(true)
    expect(
      matchesChord(chord, press({ key: '?', code: 'Minus', shiftKey: true })),
    ).toBe(true)
  })

  it('still refuses `?` when a real modifier is held', () => {
    expect(
      matchesChord(
        parseChord('?'),
        press({ key: '?', code: 'Slash', shiftKey: true, metaKey: true }),
      ),
    ).toBe(false)
  })

  it('does not confuse `?` with the key it happens to sit on', () => {
    expect(
      matchesChord(parseChord('?'), press({ key: '/', code: 'Slash' })),
    ).toBe(false)
  })
})

describe('matchesChord — AltGr', () => {
  it('never fires for AltGr, which Windows spells as Ctrl+Alt', () => {
    // A German typist reaching for µ produces exactly the ⌘⌥M event shape.
    // Without this guard, typing µ opens a comment draft mid-word.
    expect(
      matchesChord(
        parseChord('mod+alt+m'),
        press({
          key: 'µ',
          code: 'KeyM',
          ctrlKey: true,
          altKey: true,
          altGraph: true,
        }),
      ),
    ).toBe(false)
  })

  it('guards AltGr for every chord, not just the Ctrl+Alt ones', () => {
    expect(
      matchesChord(
        parseChord('mod+8'),
        press({ key: '[', code: 'Digit8', ctrlKey: true, altGraph: true }),
      ),
    ).toBe(false)
  })
})

describe('matchesChord — modifiers', () => {
  it('requires modifiers to match exactly', () => {
    const chord = parseChord('mod+k')
    expect(
      matchesChord(chord, press({ key: 'k', code: 'KeyK', metaKey: true })),
    ).toBe(true)
    expect(
      matchesChord(
        chord,
        press({ key: 'k', code: 'KeyK', metaKey: true, shiftKey: true }),
      ),
    ).toBe(false)
    expect(matchesChord(chord, press({ key: 'k', code: 'KeyK' }))).toBe(false)
  })

  it('treats Ctrl and Meta as the same modifier', () => {
    const chord = parseChord('mod+f')
    expect(matchesChord(chord, press({ key: 'f', ctrlKey: true }))).toBe(true)
    expect(matchesChord(chord, press({ key: 'f', metaKey: true }))).toBe(true)
  })
})

describe('usesExactly', () => {
  it('is true only for the exact modifier set', () => {
    const chord = parseChord('mod+alt+m')
    expect(usesExactly(chord, { mod: true, alt: true, shift: false })).toBe(true)
    expect(usesExactly(chord, { mod: true, alt: true, shift: true })).toBe(false)
    expect(usesExactly(chord, { mod: true, alt: false, shift: false })).toBe(
      false,
    )
  })
})

describe('chordSignature', () => {
  it('collapses the same chord written in different orders', () => {
    expect(chordSignature(parseChord('shift+alt+mod+z'))).toBe(
      chordSignature(parseChord('mod+alt+shift+z')),
    )
  })

  it('separates chords that differ only by a modifier', () => {
    expect(chordSignature(parseChord('mod+k'))).not.toBe(
      chordSignature(parseChord('mod+shift+k')),
    )
  })
})

describe('toProseMirrorKey', () => {
  it('spells a chord the way prosemirror-keymap normalises it', () => {
    expect(toProseMirrorKey('mod+shift+x')).toBe('Mod-Shift-x')
    expect(toProseMirrorKey('mod+alt+up')).toBe('Mod-Alt-ArrowUp')
    expect(toProseMirrorKey('alt+1')).toBe('Alt-1')
  })

  it('keeps a trailing hyphen key, which the normaliser tolerates', () => {
    expect(toProseMirrorKey('mod+alt+-')).toBe('Mod-Alt--')
  })
})
