import type { MarkType, Node as PMNode } from '@tiptap/pm/model'
import { collectThreadStarts } from '../editor/extensions/comment'
import type { ThreadWithComments } from '../types'

/**
 * Threads in the order their numbers should run down a page.
 *
 * Document order first, so footnote 2 always comes after footnote 1 on the
 * page. Threads whose anchor has been deleted have no position in that order
 * at all, so they are appended after it rather than being dropped — an orphaned
 * comment is still something the author wrote.
 *
 * Shared by the annotated HTML export and by the printed endnotes. They have to
 * agree: the same document printed and exported should number its notes
 * identically, and two copies of this logic would eventually not.
 */
export interface OrderedThreads {
  ordered: ThreadWithComments[]
  /**
   * Which of them still have their anchor in the text. The appended orphans do
   * not, and a note that cannot be linked back to a place in the document must
   * not pretend it can.
   */
  anchored: ReadonlySet<string>
}

export function orderThreadsForNotes(
  doc: PMNode,
  type: MarkType | undefined,
  threads: readonly ThreadWithComments[],
): OrderedThreads {
  const byId = new Map(threads.map(thread => [thread.id, thread]))
  const ordered: ThreadWithComments[] = []

  if (type) {
    for (const start of collectThreadStarts(doc, type, new Set(byId.keys()))) {
      const thread = byId.get(start.threadId)
      if (thread) ordered.push(thread)
    }
  }

  const anchored = new Set(ordered.map(thread => thread.id))
  for (const thread of threads) {
    if (!anchored.has(thread.id)) ordered.push(thread)
  }

  return { ordered, anchored }
}
