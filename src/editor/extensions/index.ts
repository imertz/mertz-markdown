import {
  resolveExtensions,
  type AnyExtension,
  type Editor,
} from '@tiptap/core'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { FileHandler } from '@tiptap/extension-file-handler'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { common, createLowlight } from 'lowlight'
import { EDITOR_PLACEHOLDER, MARKED_OPTIONS } from '../../markdown/config'
import { AppShortcuts } from './appShortcuts'
import { CommentMark } from './comment'
import { CommentActive } from './commentActive'
import { CommentSanitizer } from './commentSanitizer'
import { CommentSync } from './commentSync'
import { LocalImage } from './image'
import { Search } from './search'
import { TextAlign } from './textAlign'
import {
  SingleParagraphTableCell,
  SingleParagraphTableHeader,
  TableCellGuard,
} from './tableCells'
import { TableColumn } from './tableColumn'
import { TaskListShortcut } from './taskListShortcut'

export interface EditorExtensionOptions {
  /** Called whenever the set of threads with a live anchor changes. */
  onAnchorsChanged?: (threadIds: Set<string>) => void
  /** Threads belonging to the open document; anything else is foreign paste. */
  getKnownThreadIds?: () => ReadonlySet<string>
  /** Resolve browser-local image bytes for the active document. */
  resolveImageAsset?: (assetId: string) => Promise<Blob | undefined>
  /** Store and insert files supplied by drop or paste. */
  onImageFiles?: (editor: Editor, files: File[], position?: number) => void
}

const NO_THREADS: ReadonlySet<string> = new Set<string>()

/**
 * `common` is highlight.js's ~37 most-used grammars — roughly 60 KB gzipped,
 * precached by the service worker so highlighting behaves the same offline.
 * The full set is over a megabyte, for languages nobody pastes into notes.
 */
const lowlight = createLowlight(common)

/**
 * The single source of truth for the editor schema.
 *
 * Used by the live editor, by the standalone MarkdownManager in tests, and by
 * schema-lock.test.ts — so the thing under test is literally the thing that
 * ships. Every schema addition needs a matching entry in markdown/config.ts.
 *
 * The options are behavioural only; calling this with no arguments (as the
 * tests do) produces exactly the same schema.
 */
export function buildExtensions(
  options: EditorExtensionOptions = {},
): AnyExtension[] {
  return [
    StarterKit.configure({
      // Underline renders `++text++`, which is Pandoc syntax — neither
      // CommonMark nor GFM. This single flag is the difference between
      // spec-clean output and silently corrupt output.
      underline: false,
      link: {
        // Without this, typing a bare URL rewrites it as [https://x](https://x).
        autolink: false,
        openOnClick: false,
      },
      // Replaced below, not removed.
      codeBlock: false,
    }),

    /*
     * Highlighting is decorations over the same `codeBlock` node StarterKit
     * would have given us: the name is unchanged, so ALLOWED_NODES needs no
     * entry, and CodeBlockLowlight extends CodeBlock — getExtensionField walks
     * `parent`, so it inherits renderMarkdown/parseMarkdown and the ```lang
     * fence still round-trips. Nothing here reaches the document or the .md.
     */
    CodeBlockLowlight.configure({ lowlight }),

    LocalImage.configure({
      resolveAsset: options.resolveImageAsset ?? (async () => undefined),
    }),
    FileHandler.configure({
      consumePasteEvent: true,
      onDrop: options.onImageFiles
        ? (editor, files, position) =>
            options.onImageFiles?.(editor, files, position)
        : undefined,
      onPaste: options.onImageFiles
        ? (editor, files) => options.onImageFiles?.(editor, files)
        : undefined,
    }),

    // GFM extras: `- [x] ` task lists and pipe tables.
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: { resizable: true },
      // Replaced below, not removed. The kit's own copies have to be turned
      // off or the extended nodes collide with them on name.
      tableCell: false,
      tableHeader: false,
    }),
    SingleParagraphTableCell,
    SingleParagraphTableHeader,
    TableCellGuard,
    TableColumn,

    CommentMark,
    CommentActive,
    CommentSync.configure({
      onAnchorsChanged: options.onAnchorsChanged ?? (() => {}),
    }),
    CommentSanitizer.configure({
      getKnownThreadIds: options.getKnownThreadIds ?? (() => NO_THREADS),
    }),

    // Typing ergonomics and find/replace — none of these add a node or mark.
    TaskListShortcut,
    AppShortcuts,
    Search,
    TextAlign,

    Placeholder.configure({ placeholder: EDITOR_PLACEHOLDER }),

    Markdown.configure({ markedOptions: MARKED_OPTIONS }),
  ]
}

/**
 * The same list, flattened out of its kits and sorted by priority — the form
 * TipTap builds the schema from and the form MarkdownManager expects.
 * StarterKit and TableKit each expand into their constituent nodes and marks
 * here, so this is what you inspect when you want per-node config.
 */
export function buildResolvedExtensions(): AnyExtension[] {
  return resolveExtensions(buildExtensions())
}
