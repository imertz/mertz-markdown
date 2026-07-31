import type { Editor } from '@tiptap/core'
import type { DocumentsApi } from '../hooks/useDocuments'
import type { RailVisibility } from '../hooks/useRailHidden'
import type { Theme } from '../hooks/useTheme'
import type { ThreadsApi } from '../hooks/useThreads'
import type { PaletteAction } from '../components/CommandPalette'
import { formatShortcut, isApplePlatform } from '../lib/shortcuts'
import type { CommandId } from './catalog'
import { CATALOG, chordFor } from './catalog'
import type { Command, CommandContext } from './context'

/**
 * Turning the catalog — which is only names and chords — into things that run.
 *
 * The split matters: the catalog is importable from any leaf component because
 * it depends on nothing, while this file needs the whole app. Keeping them
 * apart is what lets a toolbar button print its own chord without reaching for
 * AppShell's state.
 */

/** How many documents the number row can reach. */
export const MAX_DOCUMENT_JUMPS = 9

/**
 * Everything AppShell owns that a command needs to call.
 *
 * Deliberately not memoised by the caller, and it does not need to be:
 * `useGlobalShortcuts` reads its table through a ref with an empty dependency
 * list, so rebuilding this on every render — which is unavoidable, since the
 * handlers close over state — costs one object allocation and resubscribes
 * nothing.
 */
export interface CommandDeps {
  editor: Editor | null
  documents: DocumentsApi
  threads: ThreadsApi
  rail: RailVisibility
  theme: { theme: Theme; toggle: () => void }
  ui: {
    openPalette: () => void
    openSearch: () => void
    openHistory: () => void
    openCheatSheet: () => void
    openFind: () => void
    startLink: () => void
    startDraft: () => void
    exportMarkdown: () => void
    exportDocx: () => void
    exportDocxAnnotated: () => void
    exportAnnotated: () => void
    stepSection: (delta: -1 | 1) => void
    stepThread: (delta: -1 | 1) => void
    saveVersion: () => void
    deleteActive: () => void
  }
}

/** A command built from its catalog entry, so the metadata is never restated. */
function define(
  id: CommandId,
  run: () => void,
  when?: (context: CommandContext) => boolean,
): Command {
  return { ...CATALOG[id], id, run, when }
}

const withEditor =
  (deps: CommandDeps, action: (editor: Editor) => void) => () => {
    const { editor } = deps
    if (!editor || editor.isDestroyed) return
    action(editor)
  }

const hasEditor = (context: CommandContext) =>
  Boolean(context.editor && !context.editor.isDestroyed)

/**
 * Every static command in the app.
 *
 * "Static" meaning it costs nothing to build: no document walk, no database
 * read. That is what lets this run unconditionally, which in turn is what lets
 * the cheat sheet and the peek HUD show the full picture rather than only what
 * the palette happened to assemble.
 */
export function buildCommands(deps: CommandDeps): Command[] {
  const { documents, rail, theme, threads, ui } = deps
  const editorCommand = (action: (editor: Editor) => void) =>
    withEditor(deps, action)

  const commands: Command[] = [
    // --- App -------------------------------------------------------------
    define('app.palette', ui.openPalette),
    define('app.cheatsheet', ui.openCheatSheet),
    define('app.history', ui.openHistory),
    define('app.export', ui.exportMarkdown, hasEditor),
    define('app.exportDocx', ui.exportDocx, hasEditor),
    define('app.exportDocxComments', ui.exportDocxAnnotated, hasEditor),
    define('app.exportHtml', ui.exportAnnotated, hasEditor),
    define('app.toggleRail', rail.toggle),
    define('app.toggleTheme', theme.toggle),

    // --- Documents -------------------------------------------------------
    define('doc.new', () => void documents.create()),
    define('doc.save', ui.saveVersion, hasEditor),
    define('doc.next', () => stepDocument(documents, 1), hasSiblings),
    define('doc.previous', () => stepDocument(documents, -1), hasSiblings),
    define('doc.delete', ui.deleteActive, context =>
      Boolean(context.activeDocumentId),
    ),

    // --- Navigate --------------------------------------------------------
    define('nav.prevSection', () => ui.stepSection(-1), hasEditor),
    define('nav.nextSection', () => ui.stepSection(1), hasEditor),

    // --- Find ------------------------------------------------------------
    define('find.open', ui.openFind, hasEditor),
    define('find.searchAll', ui.openSearch),
    define('find.next', () => {}),
    define('find.previous', () => {}),

    // --- Format ----------------------------------------------------------
    // Delivered by ProseMirror, never registered on the window — but they
    // still carry a `run` so the palette and the HUD reach them.
    define(
      'format.bold',
      editorCommand(e => e.chain().focus().toggleBold().run()),
      hasEditor,
    ),
    define(
      'format.italic',
      editorCommand(e => e.chain().focus().toggleItalic().run()),
      hasEditor,
    ),
    define(
      'format.strike',
      editorCommand(e => e.chain().focus().toggleStrike().run()),
      hasEditor,
    ),
    define(
      'format.code',
      editorCommand(e => e.chain().focus().toggleCode().run()),
      hasEditor,
    ),
    define(
      'format.h1',
      editorCommand(e => e.chain().focus().toggleHeading({ level: 1 }).run()),
      hasEditor,
    ),
    define(
      'format.h2',
      editorCommand(e => e.chain().focus().toggleHeading({ level: 2 }).run()),
      hasEditor,
    ),
    define(
      'format.h3',
      editorCommand(e => e.chain().focus().toggleHeading({ level: 3 }).run()),
      hasEditor,
    ),
    define(
      'format.paragraph',
      editorCommand(e => e.chain().focus().setParagraph().run()),
      hasEditor,
    ),
    define(
      'format.justify',
      editorCommand(e => e.chain().focus().setTextAlign('justify').run()),
      hasEditor,
    ),
    define(
      'format.bulletList',
      editorCommand(e => e.chain().focus().toggleBulletList().run()),
      hasEditor,
    ),
    define(
      'format.orderedList',
      editorCommand(e => e.chain().focus().toggleOrderedList().run()),
      hasEditor,
    ),
    define(
      'format.taskList',
      editorCommand(e => e.chain().focus().toggleTaskList().run()),
      hasEditor,
    ),
    define(
      'format.blockquote',
      editorCommand(e => e.chain().focus().toggleBlockquote().run()),
      hasEditor,
    ),
    define(
      'format.codeBlock',
      editorCommand(e => e.chain().focus().toggleCodeBlock().run()),
      hasEditor,
    ),
    define(
      'format.undo',
      editorCommand(e => e.chain().focus().undo().run()),
      hasEditor,
    ),
    define(
      'format.redo',
      editorCommand(e => e.chain().focus().redo().run()),
      hasEditor,
    ),

    // --- Insert ----------------------------------------------------------
    define('insert.link', ui.startLink, hasEditor),
    define(
      'insert.rule',
      editorCommand(e => e.chain().focus().setHorizontalRule().run()),
      hasEditor,
    ),
    define(
      'insert.table',
      editorCommand(e =>
        e
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
      ),
      hasEditor,
    ),

    // --- Comments --------------------------------------------------------
    define('comment.add', ui.startDraft, context => context.hasSelection),
    define('comment.previous', () => ui.stepThread(-1), hasEditor),
    define('comment.next', () => ui.stepThread(1), hasEditor),
    define('comment.submit', () => {}),
    define(
      'comment.resolveAll',
      editorCommand(e => void threads.resolveAll(e)),
      hasEditor,
    ),
  ]

  /*
   * Table commands, live only with the caret in a table.
   *
   * Not optional polish: the table extension binds Tab and Shift-Tab to cell
   * navigation, so a keyboard user inside a table cannot tab out to reach the
   * floating bar at all. These are the only route that does not need a pointer.
   *
   * Static rather than assembled when the palette opens, which is what puts
   * them in the cheat sheet's table group so it can be shown as inactive.
   */
  const inTable = (context: CommandContext) => context.inTable
  const table: [CommandId, (editor: Editor) => void][] = [
    ['table.nextCell', e => e.chain().focus().goToNextCell().run()],
    ['table.previousCell', e => e.chain().focus().goToPreviousCell().run()],
    ['table.rowAfter', e => e.chain().focus().addRowAfter().run()],
    ['table.rowDelete', e => e.chain().focus().deleteRow().run()],
    ['table.columnAfter', e => e.chain().focus().addColumnAfter().run()],
    ['table.columnDelete', e => e.chain().focus().deleteColumn().run()],
    ['table.alignLeft', e => e.chain().focus().setColumnAlignment('left').run()],
    [
      'table.alignCenter',
      e => e.chain().focus().setColumnAlignment('center').run(),
    ],
    [
      'table.alignRight',
      e => e.chain().focus().setColumnAlignment('right').run(),
    ],
    ['table.alignClear', e => e.chain().focus().setColumnAlignment(null).run()],
    ['table.headerRow', e => e.chain().focus().toggleHeaderRow().run()],
    ['table.delete', e => e.chain().focus().deleteTable().run()],
  ]
  for (const [id, action] of table) {
    commands.push(define(id, editorCommand(action), inTable))
  }

  commands.push(...documentJumps(documents))

  return commands
}

/** Whether there is anywhere else to go. */
function hasSiblings(context: CommandContext): boolean {
  return context.documentCount > 1
}

function stepDocument(documents: DocumentsApi, delta: -1 | 1): void {
  const { documents: list, activeId } = documents
  if (list.length < 2) return
  const index = list.findIndex(record => record.id === activeId)
  if (index === -1) return
  const next = (index + delta + list.length) % list.length
  documents.select(list[next].id)
}

/**
 * ⌘1 … ⌘9, one per document, labelled with the document's own name.
 *
 * The label is what makes this worth expanding rather than binding a single
 * "jump to document N": holding ⌘ shows the peek HUD, and "1 Release notes"
 * is a menu where "Jump to document 1–9" would be a riddle.
 */
function documentJumps(documents: DocumentsApi): Command[] {
  return documents.documents
    .slice(0, MAX_DOCUMENT_JUMPS)
    .map((record, index) => ({
      ...CATALOG['doc.goto'],
      id: `doc.goto:${index + 1}`,
      label: record.title,
      keys: `mod+${index + 1}`,
      run: () => documents.select(record.id),
      when: (context: CommandContext) => context.activeDocumentId !== record.id,
    }))
}

/**
 * The palette's view of the registry.
 *
 * Drops what the palette should not offer: commands with no way to run — the
 * ones a focused component owns — and the per-document jumps, since the palette
 * already lists documents by name and would otherwise show each one twice.
 */
export function toPaletteActions(
  live: readonly Command[],
  apple: boolean = isApplePlatform(),
): PaletteAction[] {
  return live
    .filter(command => command.palette !== false)
    .filter(command => command.dispatch !== 'component')
    .map(command => ({
      id: command.id,
      label: command.label,
      hint: hintOf(command, apple) || undefined,
      run: command.run,
    }))
}

/**
 * The chord this command answers to, resolved for the platform.
 *
 * Expanded entries — the per-document jumps — carry their own `keys` and are
 * not catalog ids, so they cannot be looked up.
 */
export function chordOf(command: Command, apple: boolean): string {
  if (command.id.includes(':')) return command.keys ?? ''
  return chordFor(command.id as CommandId, apple)
}

/** That chord, spelled for the reader's keyboard. */
export function hintOf(command: Command, apple: boolean): string {
  const spec = chordOf(command, apple)
  return spec ? formatShortcut(spec, apple) : ''
}
