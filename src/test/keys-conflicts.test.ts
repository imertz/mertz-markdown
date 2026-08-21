import type { Editor } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'
import { CATALOG } from '../keys/catalog'
import { findConflicts } from '../keys/conflicts'
import type { Command, CommandContext } from '../keys/context'
import type { CommandDeps } from '../keys/registry'
import { buildCommands } from '../keys/registry'

/**
 * The registry's own collision check, run against the real registry.
 *
 * The catalog test already proves no two *entries* share a chord. This proves
 * something the catalog cannot see: that after the per-document jumps are
 * expanded and the `when` predicates are applied, no two commands that are
 * simultaneously live claim the same key either.
 */

function makeDeps(documentCount: number): CommandDeps {
  const documents = Array.from({ length: documentCount }, (_, index) => ({
    id: `doc-${index + 1}`,
    title: `Document ${index + 1}`,
    updatedAt: 0,
  }))
  const noop = vi.fn()
  return {
    editor: null,
    documents: { documents, activeId: 'doc-1', select: noop } as never,
    threads: { resolveAll: noop } as never,
    rail: { hidden: false, toggle: noop, show: noop },
    library: { hidden: false, toggle: noop, hide: noop },
    theme: { theme: 'light', toggle: noop },
    focus: { on: false, toggle: noop },
    reading: { on: false, toggle: noop },
    ui: new Proxy({}, { get: () => noop }) as never,
  }
}

function makeContext(over: Partial<CommandContext> = {}): CommandContext {
  return {
    editor: { isDestroyed: false } as Editor,
    hasSelection: false,
    inTable: false,
    overlay: null,
    documentCount: 3,
    activeDocumentId: 'doc-1',
    railHidden: false,
    theme: 'light',
    ...over,
  }
}

const CONTEXTS: readonly [string, Partial<CommandContext>][] = [
  ['an empty document', {}],
  ['a selection', { hasSelection: true }],
  ['the caret in a table', { inTable: true, hasSelection: true }],
  ['no editor at all', { editor: null }],
  ['nine documents', { documentCount: 9 }],
]

describe('the real registry', () => {
  for (const apple of [true, false]) {
    const platform = apple ? 'Apple' : 'Windows and Linux'

    for (const [name, over] of CONTEXTS) {
      it(`has no colliding chords on ${platform} with ${name}`, () => {
        const deps = makeDeps(over.documentCount ?? 3)
        const conflicts = findConflicts(
          buildCommands(deps),
          makeContext(over),
          apple,
        )

        expect(
          conflicts.map(c => `${c.spec}: ${c.ids.join(' + ')}`),
        ).toEqual([])
      })
    }
  }
})

describe('findConflicts', () => {
  const command = (id: string, keys: string, when?: Command['when']): Command =>
    ({ ...CATALOG['app.palette'], id, keys, run: () => {}, when }) as Command

  it('flags two live commands claiming one chord', () => {
    const conflicts = findConflicts(
      [command('doc.goto:1', 'mod+1'), command('doc.goto:2', 'mod+1')],
      makeContext(),
      true,
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].ids).toEqual(['doc.goto:1', 'doc.goto:2'])
  })

  it('allows a shared chord when the two are never live together', () => {
    // A table command and a formatting command may share a key quite
    // legitimately; only one of them ever applies.
    const conflicts = findConflicts(
      [
        command('doc.goto:1', 'mod+1', context => context.inTable),
        command('doc.goto:2', 'mod+1', context => !context.inTable),
      ],
      makeContext({ inTable: true }),
      true,
    )

    expect(conflicts).toEqual([])
  })

  it('counts an unadvertised alias, which runs just as wrongly', () => {
    // format.strike advertises ⌘⇧X and keeps Tiptap's ⌘⇧S working unannounced,
    // so a newcomer claiming ⌘⇧S has to be caught even though nothing prints
    // that chord anywhere.
    const conflicts = findConflicts(
      [
        { ...CATALOG['format.strike'], id: 'format.strike', run: () => {} },
        command('newcomer:1', 'mod+shift+s'),
      ],
      makeContext(),
      true,
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].ids).toEqual(['format.strike', 'newcomer:1'])
  })

  it('reads a catalog command’s chord from the catalog, not from the object', () => {
    // The single-source rule, load-bearing here: a command carrying a stale
    // `keys` of its own must not be able to shadow what the catalog says, or
    // the collision check would be auditing the wrong table.
    const conflicts = findConflicts(
      [command('app.history', 'mod+k'), command('app.palette', 'mod+k')],
      makeContext(),
      true,
    )

    expect(conflicts).toEqual([])
  })
})
