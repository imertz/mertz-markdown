/**
 * Every command the app has, and the one place its chord is written down.
 *
 * Before this file there were three answers to "what does ⌘⇧K do": the binding
 * table, a `title=` string somewhere in a component, and — for everything Tiptap
 * ships — nothing at all. They drifted, and the README drifted from all three.
 * Now the matcher, the palette, the cheat sheet and every tooltip
 * read from here, so a chord has exactly one spelling and changing it changes
 * every surface at once.
 *
 * `as const satisfies` is what enforces that rather than merely encouraging it:
 * `CommandId` is a literal union, so `titleFor('format.blod')` does not
 * typecheck.
 */

import { formatShortcut, isApplePlatform } from '../lib/shortcuts'

export type CategoryId =
  | 'app'
  | 'document'
  | 'format'
  | 'insert'
  | 'navigate'
  | 'comments'
  | 'table'
  | 'find'

export interface CategoryMeta {
  id: CategoryId
  label: string
  /** Shown beside the heading when nothing in the group applies right now. */
  inactiveNote?: string
}

/** Cheat-sheet order: what you reach for most, first. */
export const CATEGORIES: readonly CategoryMeta[] = [
  { id: 'app', label: 'App' },
  { id: 'document', label: 'Documents' },
  { id: 'navigate', label: 'Navigate' },
  { id: 'find', label: 'Find' },
  { id: 'format', label: 'Format' },
  { id: 'insert', label: 'Insert' },
  { id: 'comments', label: 'Comments' },
  {
    id: 'table',
    label: 'Table',
    inactiveNote: 'with the cursor in a table',
  },
]

/**
 * Who delivers the keystroke. Determines registration, not display.
 *
 * `'window'`     the global matcher binds it.
 * `'editor'`     a ProseMirror keymap binds it — Tiptap's own, or ours. Still
 *                carries a `run`, so the palette and the HUD reach it, but the
 *                window matcher must never register it or the key fires twice.
 * `'component'`  the focused component's own `onKeyDown`. Documented here so it
 *                appears in the cheat sheet; there is nothing to register.
 */
export type Dispatch = 'window' | 'editor' | 'component'

export interface CommandMeta {
  label: string
  category: CategoryId
  /** Search terms used by contextual command menus, such as `/`. */
  menuKeywords?: readonly string[]
  /** A `formatShortcut` spec. The canonical chord, and the Apple spelling. */
  keys?: string
  /**
   * The chord to use off Apple hardware, where the canonical one is unsafe.
   *
   * Not a translation — `formatShortcut` already prints ⌘ as Ctrl. This is for
   * the cases where Ctrl+<same key> is actively wrong on Windows or Linux; see
   * the block comment above `CATALOG`.
   */
  keysOther?: string
  /** Chords that also work but are never advertised. */
  aliases?: readonly string[]
  aliasesOther?: readonly string[]
  dispatch?: Dispatch
  /** Opt out of the command palette — motion commands and per-document jumps. */
  palette?: false
  /** A caveat printed under the row in the cheat sheet. */
  note?: string
  noteOther?: string
}

/*
 * ---------------------------------------------------------------------------
 * Why some chords differ off Apple hardware
 * ---------------------------------------------------------------------------
 *
 * Three rules, each learned from a real failure:
 *
 * 1. Never ship Ctrl+Alt to Windows or Linux. Windows synthesises Ctrl+Alt for
 *    AltGr, so ⌘⌥M becomes the chord a German typist presses to get `µ`. The
 *    replacement is plain Alt, which is safe by construction: AltGr also sets
 *    ctrlKey, so an Alt-only chord can never match it.
 *
 * 2. Ctrl+Alt+arrows is worse still — GNOME and KDE take it for switching
 *    workspaces, so the browser never sees it and section navigation has simply
 *    never worked on Linux.
 *
 * 3. Where the browser has claimed a chord and there is no free alternative,
 *    say so. `note` prints in the cheat sheet. The palette reaches everything
 *    regardless, and the installed PWA window — this app's real home, it has
 *    file handlers — does not reserve any of them.
 */

export const CATALOG = {
  // --- App ---------------------------------------------------------------
  'app.palette': {
    label: 'Command palette',
    category: 'app',
    keys: 'mod+k',
  },
  'app.cheatsheet': {
    label: 'Keyboard shortcuts',
    category: 'app',
    keys: 'mod+/',
    // The gesture everyone tries first, and free to offer: a bare key is inert
    // while typing, see `firesIn`. Written as the character rather than as
    // shift+/ so that it also works on the layouts where `?` is somewhere else.
    aliases: ['?'],
    note: 'or ? when the editor is not focused',
  },
  'app.history': {
    label: 'Version history',
    category: 'app',
    keys: 'mod+shift+h',
    noteOther: 'Firefox keeps Ctrl+Shift+H for its history library',
  },
  'app.export': {
    label: 'Export as Markdown',
    category: 'app',
    keys: 'mod+shift+e',
    noteOther: 'Firefox keeps Ctrl+Shift+E for its network panel',
  },
  // No chords for these three: mod+shift+e is spoken for, and the palette and
  // the cheat sheet reach a command whether or not it has one.
  'app.exportDocx': {
    label: 'Export as Word',
    category: 'app',
  },
  'app.exportDocxComments': {
    label: 'Export with comments as Word',
    category: 'app',
  },
  'app.exportHtml': {
    label: 'Export with comments as HTML',
    category: 'app',
  },
  'app.toggleRail': {
    label: 'Show or hide comments',
    category: 'app',
    keys: 'mod+\\',
  },
  /* The other panel, on the other side, one modifier along. The pair is the
     only reason this chord is worth remembering. */
  'app.toggleLibrary': {
    label: 'Show or hide the library',
    category: 'app',
    keys: 'mod+shift+\\',
  },
  'app.toggleTheme': {
    label: 'Switch light and dark theme',
    category: 'app',
    // ⌘⇧D would be Ctrl+Shift+D off Apple, which Chrome takes for
    // "bookmark all tabs".
    keys: 'mod+shift+l',
  },
  'app.toggleFocus': {
    label: 'Focus on the current block',
    category: 'app',
    // The mod+alt row rather than mod+shift: every letter left in mod+shift is
    // spoken for by a browser (D bookmarks all tabs, I and J open devtools, O
    // the bookmark manager, P a private window), and the note on toggleTheme
    // above is this app already having been bitten by exactly that.
    //
    // Which means the AltGr rule applies — Windows synthesises Ctrl+Alt — so
    // it drops the mod off Apple, the way every other mod+alt chord here does.
    keys: 'mod+alt+f',
    keysOther: 'alt+f',
  },

  // --- Documents ---------------------------------------------------------
  'doc.new': {
    label: 'New document',
    category: 'document',
    keys: 'mod+n',
    aliases: ['mod+alt+n'],
    aliasesOther: ['alt+n'],
    note: 'the browser keeps this one; works in the installed app',
  },
  'doc.save': {
    label: 'Save a version now',
    category: 'document',
    keys: 'mod+s',
    note: 'edits already save on their own',
  },
  'doc.next': {
    label: 'Next document',
    category: 'document',
    keys: 'mod+shift+]',
  },
  'doc.previous': {
    label: 'Previous document',
    category: 'document',
    keys: 'mod+shift+[',
  },
  'doc.goto': {
    // Expanded per document by the registry, which supplies the real title.
    label: 'Jump to document 1–9',
    category: 'document',
    keys: 'mod+1',
    palette: false,
    note: 'the browser keeps these; they work in the installed app',
  },
  'doc.delete': { label: 'Move document to trash', category: 'document' },

  // --- Navigate ----------------------------------------------------------
  'nav.prevSection': {
    label: 'Previous section',
    category: 'navigate',
    keys: 'mod+alt+up',
    keysOther: 'alt+up',
  },
  'nav.nextSection': {
    label: 'Next section',
    category: 'navigate',
    keys: 'mod+alt+down',
    keysOther: 'alt+down',
  },

  // --- Find --------------------------------------------------------------
  'find.open': { label: 'Find in document', category: 'find', keys: 'mod+f' },
  'find.searchAll': {
    label: 'Search all documents',
    category: 'find',
    keys: 'mod+shift+f',
  },
  'find.next': {
    label: 'Next match',
    category: 'find',
    keys: 'enter',
    dispatch: 'component',
  },
  'find.previous': {
    label: 'Previous match',
    category: 'find',
    keys: 'shift+enter',
    dispatch: 'component',
  },

  // --- Format ------------------------------------------------------------
  // Everything below is delivered by ProseMirror. Most of it ships with Tiptap
  // and has always worked; it has simply never been written down anywhere the
  // reader could see.
  'format.bold': {
    label: 'Bold',
    category: 'format',
    keys: 'mod+b',
    dispatch: 'editor',
  },
  'format.italic': {
    label: 'Italic',
    category: 'format',
    keys: 'mod+i',
    dispatch: 'editor',
  },
  'format.strike': {
    label: 'Strikethrough',
    category: 'format',
    // Tiptap binds Mod-Shift-s, which off Apple is Ctrl+Shift+S — Firefox's
    // debugger. ⌘⇧X is free on both, so it becomes the advertised chord and
    // Tiptap's keeps working unannounced.
    keys: 'mod+shift+x',
    aliases: ['mod+shift+s'],
    dispatch: 'editor',
  },
  'format.code': {
    label: 'Inline code',
    category: 'format',
    keys: 'mod+e',
    dispatch: 'editor',
  },
  'format.h1': {
    label: 'Heading 1',
    category: 'format',
    menuKeywords: ['heading', 'title', 'large'],
    keys: 'mod+alt+1',
    keysOther: 'alt+1',
    aliasesOther: ['mod+alt+1'],
    dispatch: 'editor',
  },
  'format.h2': {
    label: 'Heading 2',
    category: 'format',
    menuKeywords: ['heading', 'subtitle', 'medium'],
    keys: 'mod+alt+2',
    keysOther: 'alt+2',
    aliasesOther: ['mod+alt+2'],
    dispatch: 'editor',
  },
  'format.h3': {
    label: 'Heading 3',
    category: 'format',
    menuKeywords: ['heading', 'subheading', 'small'],
    keys: 'mod+alt+3',
    keysOther: 'alt+3',
    aliasesOther: ['mod+alt+3'],
    dispatch: 'editor',
  },
  'format.paragraph': {
    label: 'Body text',
    category: 'format',
    keys: 'mod+alt+0',
    keysOther: 'alt+0',
    aliasesOther: ['mod+alt+0'],
    dispatch: 'editor',
  },
  'format.justify': {
    label: 'Justify paragraph',
    category: 'format',
    dispatch: 'editor',
  },
  'format.bulletList': {
    label: 'Bullet list',
    category: 'format',
    menuKeywords: ['bullets', 'unordered', 'list'],
    keys: 'mod+shift+8',
    dispatch: 'editor',
  },
  'format.orderedList': {
    label: 'Numbered list',
    category: 'format',
    menuKeywords: ['numbered', 'ordered', 'list'],
    keys: 'mod+shift+7',
    dispatch: 'editor',
  },
  'format.taskList': {
    label: 'Task list',
    category: 'format',
    menuKeywords: ['task', 'todo', 'checklist', 'checkbox'],
    keys: 'mod+shift+9',
    dispatch: 'editor',
  },
  'format.blockquote': {
    label: 'Blockquote',
    category: 'format',
    menuKeywords: ['quote', 'callout'],
    // Tiptap binds Mod-Shift-b; off Apple that is Chrome's bookmarks bar.
    keys: 'mod+shift+.',
    aliases: ['mod+shift+b'],
    dispatch: 'editor',
  },
  'format.codeBlock': {
    label: 'Code block',
    category: 'format',
    menuKeywords: ['code', 'fence', 'preformatted'],
    keys: 'mod+alt+c',
    keysOther: 'alt+c',
    aliasesOther: ['mod+alt+c'],
    dispatch: 'editor',
  },
  'format.undo': {
    label: 'Undo',
    category: 'format',
    keys: 'mod+z',
    dispatch: 'editor',
  },
  'format.redo': {
    label: 'Redo',
    category: 'format',
    keys: 'mod+shift+z',
    dispatch: 'editor',
  },
  // --- Insert ------------------------------------------------------------
  'insert.link': {
    label: 'Add or edit link',
    category: 'insert',
    menuKeywords: ['link', 'url', 'website', 'hyperlink'],
    keys: 'mod+shift+k',
    noteOther: 'Firefox keeps Ctrl+Shift+K for its web console',
  },
  'insert.rule': {
    label: 'Horizontal rule',
    category: 'insert',
    // A new binding, so it can simply avoid Ctrl+Alt on both platforms.
    keys: 'mod+alt+-',
    keysOther: 'alt+-',
    dispatch: 'editor',
  },
  'insert.table': {
    label: 'Insert table',
    category: 'insert',
    menuKeywords: ['table', 'grid', 'rows', 'columns'],
  },
  'insert.image': {
    label: 'Insert image',
    category: 'insert',
    menuKeywords: ['image', 'photo', 'picture', 'illustration'],
  },
  // --- Comments ----------------------------------------------------------
  'comment.add': {
    label: 'Comment on selection',
    category: 'comments',
    menuKeywords: ['comment', 'note', 'feedback', 'annotation'],
    keys: 'mod+alt+m',
    keysOther: 'alt+m',
  },
  'comment.previous': {
    label: 'Previous comment',
    category: 'comments',
    keys: 'mod+alt+shift+up',
    keysOther: 'alt+shift+up',
  },
  'comment.next': {
    label: 'Next comment',
    category: 'comments',
    keys: 'mod+alt+shift+down',
    keysOther: 'alt+shift+down',
  },
  'comment.submit': {
    label: 'Post comment',
    category: 'comments',
    keys: 'mod+enter',
    dispatch: 'component',
  },
  'comment.resolveAll': {
    label: 'Resolve all comments',
    category: 'comments',
  },

  // --- Table -------------------------------------------------------------
  /*
   * Not optional polish: the table extension binds Tab and Shift-Tab to cell
   * navigation, so a keyboard user with the caret in a table cannot tab out to
   * reach the floating bar at all. These are the only route to the table
   * commands that does not need a pointer.
   */
  'table.nextCell': {
    label: 'Next cell',
    category: 'table',
    keys: 'tab',
    dispatch: 'editor',
  },
  'table.previousCell': {
    label: 'Previous cell',
    category: 'table',
    keys: 'shift+tab',
    dispatch: 'editor',
  },
  'table.rowAfter': { label: 'Add row below', category: 'table' },
  'table.rowDelete': { label: 'Delete row', category: 'table' },
  'table.columnAfter': { label: 'Add column right', category: 'table' },
  'table.columnDelete': { label: 'Delete column', category: 'table' },
  'table.alignLeft': { label: 'Align column left', category: 'table' },
  'table.alignCenter': { label: 'Align column centre', category: 'table' },
  'table.alignRight': { label: 'Align column right', category: 'table' },
  'table.alignClear': { label: 'Clear column alignment', category: 'table' },
  'table.headerRow': { label: 'Toggle header row', category: 'table' },
  'table.delete': { label: 'Delete table', category: 'table' },
} as const satisfies Record<string, CommandMeta>

export type CommandId = keyof typeof CATALOG

export function metaFor(id: CommandId): CommandMeta {
  return CATALOG[id]
}

/** Every id, in declaration order — which is the order the cheat sheet reads. */
export const COMMAND_IDS = Object.keys(CATALOG) as CommandId[]

/**
 * The chord this command answers to on this platform, or `''`.
 *
 * One resolver for display and for registration alike, so the two platforms
 * cannot drift apart: whatever the cheat sheet prints is what the matcher bound.
 */
export function chordFor(id: CommandId, apple: boolean = isApplePlatform()): string {
  const meta = CATALOG[id] as CommandMeta
  return (apple ? meta.keys : (meta.keysOther ?? meta.keys)) ?? ''
}

/** The unadvertised chords that also work here. */
export function aliasesFor(
  id: CommandId,
  apple: boolean = isApplePlatform(),
): readonly string[] {
  const meta = CATALOG[id] as CommandMeta
  return (apple ? meta.aliases : (meta.aliasesOther ?? meta.aliases)) ?? []
}

/** The caveat for this platform, if there is one. */
export function noteFor(
  id: CommandId,
  apple: boolean = isApplePlatform(),
): string | undefined {
  const meta = CATALOG[id] as CommandMeta
  return (apple ? meta.note : (meta.noteOther ?? meta.note)) ?? undefined
}

/** `'⌘B'`, or `''` when the command has no chord. For a hint or a `<kbd>`. */
export function hintFor(id: CommandId, apple: boolean = isApplePlatform()): string {
  const spec = chordFor(id, apple)
  return spec ? formatShortcut(spec, apple) : ''
}

/** `'Bold (⌘B)'`, or just `'Bold'`. For a `title` attribute. */
export function titleFor(id: CommandId, apple: boolean = isApplePlatform()): string {
  const meta = CATALOG[id] as CommandMeta
  const hint = hintFor(id, apple)
  return hint ? `${meta.label} (${hint})` : meta.label
}
