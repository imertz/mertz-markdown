import { describe, expect, it } from 'vitest'
import {
  aliasesFor,
  CATALOG,
  CATEGORIES,
  chordFor,
  COMMAND_IDS,
  hintFor,
  titleFor,
  type CommandId,
  type CommandMeta,
} from '../keys/catalog'
import { chordSignature, parseChord } from '../keys/chord'

/**
 * The catalog is data, so these are the assertions that would otherwise be a
 * code review: nobody can hand-check fifty chords across two platforms for a
 * collision, and a collision is invisible until the wrong command runs.
 */

const PLATFORMS: readonly { name: string; apple: boolean }[] = [
  { name: 'Apple', apple: true },
  { name: 'Windows and Linux', apple: false },
]

/** Every chord a command answers to on a platform, advertised or not. */
function allChords(id: CommandId, apple: boolean): string[] {
  const primary = chordFor(id, apple)
  return [...(primary ? [primary] : []), ...aliasesFor(id, apple)]
}

describe('catalog integrity', () => {
  it('names a category that exists for every command', () => {
    const known = new Set(CATEGORIES.map(category => category.id))
    for (const id of COMMAND_IDS) {
      expect(known, `${id} names an unknown category`).toContain(
        (CATALOG[id] as CommandMeta).category,
      )
    }
  })

  it('covers every category with at least one command', () => {
    const used = new Set(
      COMMAND_IDS.map(id => (CATALOG[id] as CommandMeta).category),
    )
    for (const category of CATEGORIES) {
      expect(used, `${category.id} has no commands`).toContain(category.id)
    }
  })

  for (const { name, apple } of PLATFORMS) {
    it(`parses every chord on ${name}`, () => {
      for (const id of COMMAND_IDS) {
        for (const spec of allChords(id, apple)) {
          const chord = parseChord(spec)
          expect(chord.key, `${id} → "${spec}"`).not.toBe('')
        }
      }
    })

    it(`gives no two commands the same chord on ${name}`, () => {
      // The test that catches ⌘⇧X against Tiptap's own ⌘⇧S. Aliases count:
      // an unadvertised chord that runs the wrong command is still wrong.
      const claimed = new Map<string, string>()
      for (const id of COMMAND_IDS) {
        for (const spec of allChords(id, apple)) {
          const signature = chordSignature(parseChord(spec))
          const owner = claimed.get(signature)
          expect(
            owner,
            `${id} and ${owner} both claim "${spec}" on ${name}`,
          ).toBeUndefined()
          claimed.set(signature, id)
        }
      }
    })
  }

  it('never advertises Ctrl+Alt off Apple hardware', () => {
    /*
     * Rule 1, enforced mechanically rather than by memory. Windows synthesises
     * Ctrl+Alt for AltGr, so any advertised chord using both is a chord some
     * European typist presses to get a character.
     */
    for (const id of COMMAND_IDS) {
      const spec = chordFor(id, false)
      if (!spec) continue
      const chord = parseChord(spec)
      expect(
        chord.mod && chord.alt,
        `${id} advertises "${spec}", which is AltGr on Windows`,
      ).toBe(false)
    }
  })
})

describe('chordFor', () => {
  it('falls back to the canonical chord when there is no override', () => {
    expect(chordFor('app.palette', true)).toBe('mod+k')
    expect(chordFor('app.palette', false)).toBe('mod+k')
  })

  it('swaps in the safe chord off Apple where one is declared', () => {
    expect(chordFor('comment.add', true)).toBe('mod+alt+m')
    expect(chordFor('comment.add', false)).toBe('alt+m')
    expect(chordFor('nav.nextSection', false)).toBe('alt+down')
  })

  it('keeps the Tiptap chord working off Apple, just unadvertised', () => {
    expect(chordFor('format.h1', false)).toBe('alt+1')
    expect(aliasesFor('format.h1', false)).toContain('mod+alt+1')
  })

  it('is empty for a command with no chord', () => {
    expect(chordFor('insert.table', true)).toBe('')
  })
})

describe('titleFor and hintFor', () => {
  it('spells a tooltip for the reader’s own keyboard', () => {
    expect(titleFor('format.bold', true)).toBe('Bold (⌘B)')
    expect(titleFor('format.bold', false)).toBe('Bold (Ctrl+B)')
  })

  it('drops the parenthetical when there is no chord', () => {
    expect(titleFor('insert.table', true)).toBe('Insert table')
    expect(hintFor('insert.table', true)).toBe('')
  })

  it('prints the platform-specific chord, not a translation of the other', () => {
    expect(hintFor('comment.add', true)).toBe('⌘⌥M')
    expect(hintFor('comment.add', false)).toBe('Alt+M')
  })

  it('prints the new punctuation and digit chords legibly', () => {
    expect(hintFor('format.blockquote', true)).toBe('⌘⇧.')
    expect(hintFor('format.bulletList', false)).toBe('Ctrl+Shift+8')
    expect(hintFor('app.toggleRail', false)).toBe('Ctrl+\\')
    expect(hintFor('table.previousCell', true)).toBe('⇧⇥')
  })
})
