/**
 * The output dialect this app guarantees.
 *
 * GFM is a formal spec and a strict superset of CommonMark, so tables, task
 * lists and ~~strikethrough~~ are in. Anything *outside* GFM is out — most
 * notably `++underline++`, which StarterKit's Underline extension emits by
 * default and which a conforming parser renders as literal plus signs. That is
 * the backward-compatibility line this file exists to hold.
 */
export const MARKDOWN_DIALECT = 'gfm' as const

/**
 * Every node name allowed in the editor schema.
 *
 * Adding an extension without listing it here fails schema-lock.test.ts. That
 * matters more than it looks: MarkdownManager.renderNodeToMarkdown returns ''
 * for a node type it has no handler for, so an unvetted node is dropped from
 * export silently — data loss, not just lost formatting.
 */
export const ALLOWED_NODES = [
  'doc',
  'text',
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
  'image',
] as const

/**
 * Nodes whose markdown is emitted by an ancestor, so they must NOT declare a
 * renderer of their own.
 *
 * `table.renderMarkdown` delegates to renderTableToMarkdown, which walks rows
 * and cells itself and emits the whole pipe table in one go. The schema only
 * permits these three inside a table, so they are never reached standalone.
 *
 * This list is an explicit carve-out, not a loosening: any *other* node lacking
 * a renderer still fails schema-lock.test.ts, because a node the serializer has
 * no handler for is dropped from export silently.
 */
export const PARENT_RENDERED_NODES = [
  'tableRow',
  'tableHeader',
  'tableCell',
] as const

/** Every mark name allowed in the editor schema. */
export const ALLOWED_MARKS = [
  'bold',
  'italic',
  'code',
  'link',
  'strike', // GFM
  'comment', // renders to nothing — sidecar only
] as const

/**
 * Marks that intentionally contribute no markdown syntax whatsoever. The
 * comments-are-sidecar design rests entirely on these staying invisible.
 */
export const INVISIBLE_MARKS = ['comment'] as const

/**
 * Passed straight to `marked.setOptions`.
 * `breaks: false` keeps a single newline a soft break, per CommonMark.
 */
export const MARKED_OPTIONS = {
  gfm: true,
  breaks: false,
  pedantic: false,
} as const

export const EDITOR_PLACEHOLDER = 'Start writing…'
