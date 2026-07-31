import type { ThreadWithComments } from '../types'
import { STYLE_IDS } from './styles'
import { element, textElement, xmlPart } from './xml'

/**
 * `word/comments.xml` and the ids that tie it to the body.
 *
 * A thread becomes **one** Word comment, with its replies as further
 * paragraphs inside it. True threaded replies live in
 * `word/commentsExtended.xml`, keyed by `w15:paraId` values that must match
 * paragraph attributes in this part — a second, parallel identity scheme whose
 * only reward is the reply indent. One comment per thread keeps every word the
 * user wrote, in order, attributed, and needs no such scheme.
 *
 * Ids are assigned on first sight during the document walk, which is what makes
 * them run in document order. Threads whose anchor is gone are claimed
 * afterwards, so they sort after every anchored one — the same ordering
 * `toAnnotatedHtml` produces.
 */

export interface CommentEntry {
  id: number
  thread: ThreadWithComments
}

export class CommentRegistry {
  private readonly byThread = new Map<string, number>()
  private readonly claimed: CommentEntry[] = []
  private readonly known: Map<string, ThreadWithComments>

  constructor(threads: readonly ThreadWithComments[]) {
    this.known = new Map(threads.map(thread => [thread.id, thread]))
  }

  /**
   * The Word comment id for a thread, allocated on first request.
   *
   * `null` for a thread this document does not own — a comment mark can arrive
   * by paste, and CommentSanitizer strips those only on the way *in*, so the
   * exporter must not assume every mark it meets resolves.
   */
  idFor(threadId: string): number | null {
    const existing = this.byThread.get(threadId)
    if (existing !== undefined) return existing

    const thread = this.known.get(threadId)
    if (!thread) return null

    const id = this.claimed.length
    this.byThread.set(threadId, id)
    this.claimed.push({ id, thread })
    return id
  }

  /** Threads with no anchor left in the document, in their original order. */
  claimUnanchored(): CommentEntry[] {
    const orphans: CommentEntry[] = []
    for (const thread of this.known.values()) {
      if (this.byThread.has(thread.id)) continue
      const id = this.claimed.length
      this.byThread.set(thread.id, id)
      const entry = { id, thread }
      this.claimed.push(entry)
      orphans.push(entry)
    }
    return orphans
  }

  get entries(): readonly CommentEntry[] {
    return this.claimed
  }
}

/** `<w:commentRangeStart>` / `<w:commentRangeEnd>` plus the reference run. */
export const commentRangeStart = (id: number): string =>
  element('w:commentRangeStart', { 'w:id': id })

export const commentRangeEnd = (id: number): string =>
  element('w:commentRangeEnd', { 'w:id': id }) +
  element('w:r', undefined, [
    element(
      'w:rPr',
      undefined,
      element('w:rStyle', { 'w:val': STYLE_IDS.commentReference }),
    ),
    element('w:commentReference', { 'w:id': id }),
  ])

const initialsOf = (author: string): string =>
  author
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3) || 'A'

/** Word wants an unzoned ISO 8601 instant with a literal Z. */
const stamp = (at: number): string => `${new Date(at).toISOString().slice(0, 19)}Z`

function commentParagraph(text: string, first: boolean): string {
  return element('w:p', undefined, [
    element(
      'w:pPr',
      undefined,
      element('w:pStyle', { 'w:val': STYLE_IDS.commentText }),
    ),
    // The conventional marker that this paragraph carries the comment's own
    // reference glyph. Word draws the id from the enclosing w:comment.
    first
      ? element('w:r', undefined, [
          element(
            'w:rPr',
            undefined,
            element('w:rStyle', { 'w:val': STYLE_IDS.commentReference }),
          ),
          element('w:annotationRef'),
        ])
      : '',
    text
      ? element(
          'w:r',
          undefined,
          textElement('w:t', { 'xml:space': 'preserve' }, text),
        )
      : '',
  ])
}

function comment(entry: CommentEntry): string {
  const { id, thread } = entry
  const [first, ...replies] = thread.comments
  const author = first?.author ?? 'You'

  const lines: string[] = []

  // The thread's state is metadata Word has no field for outside
  // commentsExtended, so it is said in words rather than lost.
  if (thread.status === 'resolved') lines.push('Resolved')
  if (thread.status === 'orphaned') lines.push('The commented text was deleted')
  if (first) lines.push(first.body)

  // A reply's own author would otherwise be lost: w:comment carries exactly one.
  for (const reply of replies) {
    lines.push(`${reply.author} · ${new Date(reply.createdAt).toLocaleString()}`)
    lines.push(reply.body)
  }

  return element(
    'w:comment',
    {
      'w:id': id,
      'w:author': author,
      'w:initials': initialsOf(author),
      'w:date': stamp(first?.createdAt ?? thread.createdAt),
    },
    // A w:comment with no paragraph at all is invalid.
    lines.length
      ? lines.map((line, index) => commentParagraph(line, index === 0))
      : commentParagraph('', true),
  )
}

export function buildComments(entries: readonly CommentEntry[]): string {
  return xmlPart(
    element(
      'w:comments',
      {
        'xmlns:w':
          'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      },
      entries.map(comment),
    ),
  )
}
