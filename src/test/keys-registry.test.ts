import type { Editor } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentsApi } from '../hooks/useDocuments'
import type { CommandContext } from '../keys/context'
import { isLive } from '../keys/context'
import type { CommandDeps } from '../keys/registry'
import {
  buildCommands,
  chordOf,
  MAX_DOCUMENT_JUMPS,
  toPaletteActions,
} from '../keys/registry'

/**
 * The registry is where the catalog stops being a table and starts being
 * behaviour, so these check the two things a table cannot express: that a
 * command runs the thing its label promises, and that it is only offered when
 * it would actually do something.
 */

function makeDocuments(count: number, activeId: string | null): DocumentsApi {
  const documents = Array.from({ length: count }, (_, index) => ({
    id: `doc-${index + 1}`,
    title: `Document ${index + 1}`,
    updatedAt: 0,
  }))
  return {
    documents,
    trashed: [],
    activeId,
    initialDoc: null,
    status: 'saved',
    activeTitle: 'Document 1',
    select: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
    destroy: vi.fn(),
    rename: vi.fn(),
    save: vi.fn(),
    snapshot: vi.fn(),
    importFile: vi.fn(),
  } as unknown as DocumentsApi
}

function makeDeps(overrides: { documents?: DocumentsApi } = {}) {
  const ui = {
    openPalette: vi.fn(),
    openSearch: vi.fn(),
    openHistory: vi.fn(),
    openCheatSheet: vi.fn(),
    openFind: vi.fn(),
    startLink: vi.fn(),
    startDraft: vi.fn(),
    exportMarkdown: vi.fn(),
    exportDocx: vi.fn(),
    exportDocxAnnotated: vi.fn(),
    exportAnnotated: vi.fn(),
    stepSection: vi.fn(),
    stepThread: vi.fn(),
    saveVersion: vi.fn(),
    deleteActive: vi.fn(),
  }
  const documents = overrides.documents ?? makeDocuments(3, 'doc-1')
  const deps: CommandDeps = {
    editor: null,
    documents,
    threads: { resolveAll: vi.fn() } as never,
    rail: { hidden: false, toggle: vi.fn(), show: vi.fn() },
    library: { hidden: false, toggle: vi.fn(), hide: vi.fn() },
    theme: { theme: 'light', toggle: vi.fn() },
    focus: { on: false, toggle: vi.fn() },
    ui,
  }
  return { deps, ui, documents }
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

const find = (deps: CommandDeps, id: string) =>
  buildCommands(deps).find(command => command.id === id)

describe('document jumps', () => {
  it('expands one per document, capped at the number row', () => {
    const { deps } = makeDeps({ documents: makeDocuments(12, 'doc-1') })
    const jumps = buildCommands(deps).filter(command =>
      command.id.startsWith('doc.goto:'),
    )

    expect(jumps).toHaveLength(MAX_DOCUMENT_JUMPS)
    expect(jumps.map(jump => jump.keys)).toEqual([
      'mod+1',
      'mod+2',
      'mod+3',
      'mod+4',
      'mod+5',
      'mod+6',
      'mod+7',
      'mod+8',
      'mod+9',
    ])
  })

  it('labels each with the document’s own name, for the palette and cheat sheet', () => {
    const { deps } = makeDeps()
    expect(find(deps, 'doc.goto:2')?.label).toBe('Document 2')
  })

  it('selects the document the number names', () => {
    const { deps, documents } = makeDeps()
    find(deps, 'doc.goto:3')?.run()
    expect(documents.select).toHaveBeenCalledWith('doc-3')
  })

  it('is not offered for the document already open', () => {
    const { deps } = makeDeps()
    const context = makeContext({ activeDocumentId: 'doc-2' })

    expect(isLive(find(deps, 'doc.goto:1')!, context)).toBe(true)
    expect(isLive(find(deps, 'doc.goto:2')!, context)).toBe(false)
  })
})

describe('document stepping', () => {
  it('wraps around the list', () => {
    const { deps, documents } = makeDeps({
      documents: makeDocuments(3, 'doc-3'),
    })
    find(deps, 'doc.next')?.run()
    expect(documents.select).toHaveBeenCalledWith('doc-1')
  })

  it('goes quiet when there is nowhere else to go', () => {
    const { deps } = makeDeps({ documents: makeDocuments(1, 'doc-1') })
    const context = makeContext({ documentCount: 1 })

    expect(isLive(find(deps, 'doc.next')!, context)).toBe(false)
  })
})

describe('when predicates', () => {
  it('offers commenting only with something selected', () => {
    const { deps } = makeDeps()
    const comment = find(deps, 'comment.add')!

    expect(isLive(comment, makeContext({ hasSelection: false }))).toBe(false)
    expect(isLive(comment, makeContext({ hasSelection: true }))).toBe(true)
  })

  it('offers every table command only inside a table', () => {
    const { deps } = makeDeps()
    const table = buildCommands(deps).filter(command =>
      command.id.startsWith('table.'),
    )
    expect(table.length).toBeGreaterThan(0)

    for (const command of table) {
      expect(isLive(command, makeContext({ inTable: false })), command.id).toBe(
        false,
      )
      expect(isLive(command, makeContext({ inTable: true })), command.id).toBe(
        true,
      )
    }
  })

  it('stands editor commands down when there is no editor', () => {
    const { deps } = makeDeps()
    const context = makeContext({ editor: null })

    expect(isLive(find(deps, 'format.bold')!, context)).toBe(false)
    // The palette does not need an editor to open.
    expect(isLive(find(deps, 'app.palette')!, context)).toBe(true)
  })
})

describe('wiring', () => {
  it('routes ⌘S through the caller’s save, not straight to a snapshot', () => {
    const { deps, ui } = makeDeps()
    find(deps, 'doc.save')?.run()
    expect(ui.saveVersion).toHaveBeenCalledOnce()
  })

  it('routes the theme toggle to the theme hook', () => {
    const { deps } = makeDeps()
    find(deps, 'app.toggleTheme')?.run()
    expect(deps.theme.toggle).toHaveBeenCalledOnce()
  })
})

describe('toPaletteActions', () => {
  it('drops the per-document jumps, which the palette lists by name', () => {
    const { deps } = makeDeps()
    const actions = toPaletteActions(buildCommands(deps), true)

    expect(actions.some(action => action.id.startsWith('doc.goto:'))).toBe(false)
  })

  it('drops commands a focused component owns', () => {
    const { deps } = makeDeps()
    const actions = toPaletteActions(buildCommands(deps), true)

    expect(actions.some(action => action.id === 'comment.submit')).toBe(false)
    expect(actions.some(action => action.id === 'find.next')).toBe(false)
  })

  it('stamps each row with the chord for this keyboard', () => {
    const { deps } = makeDeps()
    const commands = buildCommands(deps)

    const apple = toPaletteActions(commands, true)
    const other = toPaletteActions(commands, false)

    expect(apple.find(a => a.id === 'comment.add')?.hint).toBe('⌘⌥M')
    expect(other.find(a => a.id === 'comment.add')?.hint).toBe('Alt+M')
  })

  it('leaves a chordless command without a hint', () => {
    const { deps } = makeDeps()
    const actions = toPaletteActions(buildCommands(deps), true)

    expect(actions.find(a => a.id === 'insert.table')?.hint).toBeUndefined()
  })
})

describe('chordOf', () => {
  it('reads an expanded entry’s own chord rather than the catalog', () => {
    const { deps } = makeDeps()
    expect(chordOf(find(deps, 'doc.goto:2')!, true)).toBe('mod+2')
  })

  it('resolves a catalog entry per platform', () => {
    const { deps } = makeDeps()
    const section = find(deps, 'nav.nextSection')!

    expect(chordOf(section, true)).toBe('mod+alt+down')
    expect(chordOf(section, false)).toBe('alt+down')
  })
})
