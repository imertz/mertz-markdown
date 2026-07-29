import type { CommentRecord, ThreadRecord, ThreadWithComments } from '../types'
import { getDB } from './client'

/** All threads for a document, each joined with its comments (oldest first). */
export async function loadThreadsForDoc(
  docId: string,
): Promise<ThreadWithComments[]> {
  const db = await getDB()
  const tx = db.transaction(['threads', 'comments'], 'readonly')

  const [threads, comments] = await Promise.all([
    tx.objectStore('threads').index('by-docId').getAll(docId),
    tx.objectStore('comments').index('by-docId').getAll(docId),
  ])
  await tx.done

  const byThread = new Map<string, CommentRecord[]>()
  for (const comment of comments) {
    const bucket = byThread.get(comment.threadId)
    if (bucket) bucket.push(comment)
    else byThread.set(comment.threadId, [comment])
  }

  return threads
    .map(thread => ({
      ...thread,
      comments: (byThread.get(thread.id) ?? []).sort(
        (a, b) => a.createdAt - b.createdAt,
      ),
    }))
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** Write several thread records in one transaction (used by the reconciler). */
export async function putThreads(records: ThreadRecord[]): Promise<void> {
  if (!records.length) return
  const db = await getDB()
  const tx = db.transaction('threads', 'readwrite')
  await Promise.all([...records.map(r => tx.store.put(r)), tx.done])
}

export async function putThread(record: ThreadRecord): Promise<void> {
  await (await getDB()).put('threads', record)
}

/** Create a thread and its opening comment atomically. */
export async function createThread(
  thread: ThreadRecord,
  first: CommentRecord,
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['threads', 'comments'], 'readwrite')
  await Promise.all([
    tx.objectStore('threads').put(thread),
    tx.objectStore('comments').put(first),
    tx.done,
  ])
}

export async function putComment(comment: CommentRecord): Promise<void> {
  await (await getDB()).put('comments', comment)
}

export async function deleteComment(id: string): Promise<void> {
  await (await getDB()).delete('comments', id)
}

/** Remove a thread and every comment on it in one transaction. */
export async function deleteThreadCascade(threadId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['threads', 'comments'], 'readwrite')
  const commentStore = tx.objectStore('comments')

  const commentIds = await commentStore.index('by-threadId').getAllKeys(threadId)

  await Promise.all([
    tx.objectStore('threads').delete(threadId),
    ...commentIds.map(id => commentStore.delete(id)),
    tx.done,
  ])
}
