import type { JSONContent } from '@tiptap/core'
import type { CommentRecord, DocumentRecord, TextQuoteSelector } from '../types'
import { BLOCK_SEP, flattenSubtree } from './flatten'
import type { PassageDoc, PassageKind } from './types'

/**
 * Turning a document into indexable passages.
 *
 * Pure: a record goes in, records come out. No database, no editor, no
 * ProseMirror schema — which is what lets the boot-time rebuild run over every
 * document at once and makes the whole thing trivial to test.
 *
 * Text comes from `DocumentRecord.doc`, not `DocumentRecord.markdown`, even
 * though a comment on that field calls it the search haystack. The markdown is
 * escaped for export (`snake_case` ships as `snake\_case`) and carries syntax —
 * indexing it would put backslashes, pipe characters and URL hostnames in the
 * inverted index. The JSON also gives block structure for free, which is what a
 * passage *is*.
 */

/**
 * Blocks that become one passage each, and are not descended into further.
 *
 * `listItem` swallowing a nested list is deliberate: a bullet with sub-bullets
 * reads as one unit, and BM25's length normalisation already handles the longer
 * text. Splitting them would need a rule for which nesting level owns the text.
 */
const PASSAGE_LEAF: Record<string, PassageKind> = {
  paragraph: 'paragraph',
  heading: 'heading',
  codeBlock: 'codeBlock',
  listItem: 'listItem',
  taskItem: 'listItem',
  tableRow: 'tableRow',
}

/** Long enough to be unique in a document, short enough to stay quotable. */
const ANCHOR_LENGTH = 80
/** Matches CONTEXT_LENGTH in src/markdown/anchors.ts. */
const CONTEXT_LENGTH = 32

const HEADING_JOIN = ' › '

interface RawBlock {
  node: JSONContent
  kind: PassageKind
  /** 1–6 for headings, 0 for everything else. */
  level: number
}

/** Every passage block in document order. */
function collectBlocks(doc: JSONContent): RawBlock[] {
  const blocks: RawBlock[] = []

  const visit = (node: JSONContent): void => {
    const kind = node.type ? PASSAGE_LEAF[node.type] : undefined
    if (kind) {
      blocks.push({
        node,
        kind,
        level: kind === 'heading' ? Number(node.attrs?.level) || 1 : 0,
      })
      return
    }
    for (const child of node.content ?? []) visit(child)
  }

  visit(doc)
  return blocks
}

/** Headings above this block, outermost first. */
function pushHeading(stack: { level: number; text: string }[], level: number, text: string) {
  while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
  stack.push({ level, text })
}

const readable = (flat: string): string => flat.replace(/\s+/g, ' ').trim()

/**
 * The run of text an anchor quotes, and where it starts inside the block.
 *
 * The *first* run is usually the right one, but a block that opens with an
 * image gives a run of nothing but whitespace — an anchor that would resolve
 * against the first stray indent anywhere in the document. Skipping to the
 * first run with real content costs nothing and removes that whole class of
 * mis-jump.
 */
function anchorRun(flat: string): { exact: string; offset: number } {
  let offset = 0
  for (const run of flat.split(BLOCK_SEP)) {
    if (run.trim() !== '') return { exact: run.slice(0, ANCHOR_LENGTH), offset }
    offset += run.length + BLOCK_SEP.length
  }
  return { exact: '', offset: 0 }
}

export function collectPassages(record: DocumentRecord): PassageDoc[] {
  const blocks = collectBlocks(record.doc)
  const trashed = record.deletedAt !== null

  // Blocks with no text of their own contribute nothing to the flat string —
  // the flattener only emits a separator ahead of real text — so dropping them
  // here keeps offsets honest as well as keeping empty rows out of results.
  const kept = blocks
    .map(block => ({ block, flat: flattenSubtree(block.node) }))
    .filter(entry => entry.flat.trim() !== '')

  /*
   * The whole-document flat string, rebuilt by joining blocks with one
   * separator each. That is exactly what the flattener produces for the same
   * tree, because a block boundary always breaks a text run — so offsets taken
   * here are the offsets `resolveSelector` will search against.
   */
  let flatDoc = ''
  const starts: number[] = []
  for (const entry of kept) {
    if (flatDoc) flatDoc += BLOCK_SEP
    starts.push(flatDoc.length)
    flatDoc += entry.flat
  }

  const headings: { level: number; text: string }[] = []
  const passages: PassageDoc[] = []

  // One title record rather than a title on every passage: see PassageDoc.title.
  passages.push({
    id: `${record.id}#title`,
    docId: record.id,
    text: record.title,
    headingPath: '',
    kind: 'title',
    source: 'document',
    trashed,
    updatedAt: record.updatedAt,
    title: record.title,
    // Nothing to quote — a title hit just opens the document.
    anchor: { exact: '', prefix: '', suffix: '' },
  })

  kept.forEach((entry, index) => {
    const { block, flat } = entry
    const start = starts[index]
    const path = headings.map(entry_ => entry_.text).join(HEADING_JOIN)

    const { exact, offset } = anchorRun(flat)
    const at = start + offset
    const anchor: TextQuoteSelector = {
      exact,
      prefix: flatDoc.slice(Math.max(0, at - CONTEXT_LENGTH), at),
      suffix: flatDoc.slice(at + exact.length, at + exact.length + CONTEXT_LENGTH),
    }

    passages.push({
      id: `${record.id}#${index}`,
      docId: record.id,
      text: readable(flat),
      headingPath: path,
      kind: block.kind,
      source: 'document',
      trashed,
      updatedAt: record.updatedAt,
      title: record.title,
      anchor,
    })

    // After building its own passage, so a heading is not its own ancestor.
    if (block.kind === 'heading') {
      pushHeading(headings, block.level, readable(flat))
    }
  })

  return passages
}

/**
 * Comment bodies, which today are searchable by nothing at all.
 *
 * The anchor is empty: a comment lives in the rail, not in the text, so opening
 * it means selecting the thread rather than moving the caret. `threadId` is
 * what the panel uses to do that.
 */
export function collectCommentPassages(
  record: DocumentRecord,
  comments: readonly CommentRecord[],
): PassageDoc[] {
  const trashed = record.deletedAt !== null

  return comments
    .filter(comment => comment.body.trim() !== '')
    .map(comment => ({
      id: `comment:${comment.id}`,
      docId: record.id,
      text: readable(comment.body),
      headingPath: '',
      kind: 'comment' as const,
      source: 'comment' as const,
      trashed,
      updatedAt: comment.updatedAt,
      title: record.title,
      anchor: { exact: '', prefix: '', suffix: '' },
      threadId: comment.threadId,
    }))
}
