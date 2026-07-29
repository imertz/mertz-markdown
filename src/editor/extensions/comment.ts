import { Mark, mergeAttributes } from '@tiptap/core'
import type {
  MarkType,
  Mark as PMMark,
  Node as PMNode,
} from '@tiptap/pm/model'

export const COMMENT_MARK_NAME = 'comment'

export interface CommentMarkOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      /** Attach a thread to the current (non-empty) selection. */
      setComment: (threadId: string) => ReturnType
      /** Remove one thread's anchors. */
      unsetComment: (threadId: string) => ReturnType
      /** Flip resolved styling without disturbing the anchor range. */
      setCommentResolved: (threadId: string, resolved: boolean) => ReturnType
    }
  }
}

export interface MarkRangeHit {
  from: number
  to: number
  mark: PMMark
}

/** Every text range carrying `type`, optionally narrowed to a single thread. */
export function findMarkRanges(
  doc: PMNode,
  type: MarkType,
  threadId?: string,
): MarkRangeHit[] {
  const hits: MarkRangeHit[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    for (const mark of node.marks) {
      if (mark.type !== type) continue
      if (threadId !== undefined && mark.attrs.threadId !== threadId) continue
      hits.push({ from: pos, to: pos + node.nodeSize, mark })
    }
  })
  return hits
}

/** Thread ids that still have at least one anchor in the document. */
export function collectAnchoredThreadIds(doc: PMNode): Set<string> {
  const ids = new Set<string>()
  doc.descendants(node => {
    if (!node.isText) return
    for (const mark of node.marks) {
      if (mark.type.name === COMMENT_MARK_NAME && mark.attrs.threadId) {
        ids.add(mark.attrs.threadId as string)
      }
    }
  })
  return ids
}

export interface ThreadStart {
  /** Position of the thread's first anchor. */
  from: number
  threadId: string
}

/** Each thread's first anchor, in document order, restricted to `threadIds`. */
export function collectThreadStarts(
  doc: PMNode,
  type: MarkType,
  threadIds: ReadonlySet<string>,
): ThreadStart[] {
  // Applying a comment mark splits the text node it covers, so findMarkRanges
  // reports several hits for one thread. Keeping only the first hit per thread
  // is what stops navigation from stepping twice inside the same thread.
  const seen = new Set<string>()
  const starts: ThreadStart[] = []

  for (const hit of findMarkRanges(doc, type)) {
    const threadId = hit.mark.attrs.threadId as string | undefined
    if (!threadId || seen.has(threadId) || !threadIds.has(threadId)) continue
    seen.add(threadId)
    starts.push({ from: hit.from, threadId })
  }

  return starts
}

/**
 * The next thread anchored after `after`, wrapping to the first.
 *
 * Wrapping rather than stopping at the end is what makes repeated clicks a
 * cycle: with a single thread in the document, the answer is always that
 * thread, so the control never goes dead.
 */
export function nextThreadAfter(
  doc: PMNode,
  type: MarkType,
  threadIds: ReadonlySet<string>,
  after: number,
): ThreadStart | null {
  const starts = collectThreadStarts(doc, type, threadIds)
  if (starts.length === 0) return null
  return starts.find(start => start.from > after) ?? starts[0]
}

export const CommentMark = Mark.create<CommentMarkOptions>({
  name: COMMENT_MARK_NAME,

  // ────────────────────────────────────────────────────────────────────────
  // There is deliberately NO renderMarkdown / markdownTokenName /
  // markdownTokenizer here.
  //
  // @tiptap/markdown's MarkdownManager.getMarkOpening does:
  //     if (!handler || !handler.renderMarkdown) { return "" }
  // so a mark that declares no renderer contributes the empty string on both
  // sides. That omission is the entire mechanism keeping comment anchors out of
  // the exported .md file — adding any of those fields would write proprietary
  // syntax into a document that must stay spec-clean.
  //
  // Guarded by src/test/schema-lock.test.ts.
  // ────────────────────────────────────────────────────────────────────────

  /** Typing at either edge must not silently swallow the new text. */
  inclusive: false,

  /**
   * Empty string excludes nothing — not even another comment mark — which is
   * what lets two threads overlap on the same text. Consequence: ProseMirror
   * will not replace a same-type mark on addMark, so attribute changes have to
   * be remove-then-add (see setCommentResolved).
   */
  excludes: '',

  /** A thread annotates a contiguous inline range; splitting a block ends it. */
  keepOnSplit: false,

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-thread'),
        renderHTML: attributes =>
          attributes.threadId
            ? { 'data-comment-thread': attributes.threadId as string }
            : {},
      },
      resolved: {
        default: false,
        parseHTML: element =>
          element.getAttribute('data-comment-resolved') === 'true',
        renderHTML: attributes =>
          attributes.resolved ? { 'data-comment-resolved': 'true' } : {},
      },
    }
  },

  /**
   * Needed so cut/paste inside one document keeps its anchors — ProseMirror's
   * clipboard round-trips through HTML. Anchors pasted in from a *foreign*
   * document are stripped by CommentSanitizer, not by dropping this rule.
   */
  parseHTML() {
    return [{ tag: 'span[data-comment-thread]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { class: 'comment-anchor' },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      0,
    ]
  },

  addCommands() {
    return {
      setComment:
        (threadId: string) =>
        ({ state, commands }) => {
          if (state.selection.empty) return false
          return commands.setMark(this.name, { threadId, resolved: false })
        },

      unsetComment:
        (threadId: string) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.marks[this.name]
          if (!type) return false
          const hits = findMarkRanges(state.doc, type, threadId)
          if (!hits.length) return false
          if (dispatch) {
            // removeMark never shifts positions, so no mapping is needed here.
            // Passing the mark instance (not the type) leaves any overlapping
            // thread's mark untouched.
            for (const { from, to, mark } of hits) tr.removeMark(from, to, mark)
          }
          return true
        },

      setCommentResolved:
        (threadId: string, resolved: boolean) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.marks[this.name]
          if (!type) return false
          const hits = findMarkRanges(state.doc, type, threadId)
          if (!hits.length) return false
          if (dispatch) {
            for (const { from, to, mark } of hits) {
              // excludes:'' means addMark would ADD a second mark instead of
              // replacing this one, so remove first.
              tr.removeMark(from, to, mark)
              tr.addMark(from, to, type.create({ ...mark.attrs, resolved }))
            }
            // Resolving is metadata, not an edit — keep it out of undo.
            tr.setMeta('addToHistory', false)
          }
          return true
        },
    }
  },
})
