import type { CommentRecord, ThreadRecord, ThreadWithComments } from '../types'
import { announceDirty, dirtyRecord } from '../sync/local'
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

/** Every comment on one document, in creation order. */
export async function listCommentsForDoc(
  docId: string,
): Promise<CommentRecord[]> {
  const db = await getDB()
  const comments = await db.getAllFromIndex('comments', 'by-docId', docId)
  return comments.sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * Every comment in the database, bucketed by document.
 *
 * Only the search index needs this: it builds in one pass over all documents,
 * and asking per document would be one transaction each. Everything else in the
 * app works a document at a time and should keep using `loadThreadsForDoc`.
 */
export async function listAllComments(): Promise<Map<string, CommentRecord[]>> {
  const db = await getDB()
  const all = await db.getAll('comments')

  const byDoc = new Map<string, CommentRecord[]>()
  for (const comment of all) {
    const bucket = byDoc.get(comment.docId)
    if (bucket) bucket.push(comment)
    else byDoc.set(comment.docId, [comment])
  }
  for (const bucket of byDoc.values()) {
    bucket.sort((a, b) => a.createdAt - b.createdAt)
  }
  return byDoc
}

/** Write several thread records in one transaction (used by the reconciler). */
export async function putThreads(records: ThreadRecord[]): Promise<void> {
  if (!records.length) return
  const db = await getDB()
  const tx = db.transaction(['threads', 'syncOutbox'], 'readwrite')
  await Promise.all([
    ...records.map(r => tx.objectStore('threads').put(r)),
    ...[...new Set(records.map(record => record.docId))].map(docId =>
      tx.objectStore('syncOutbox').put(dirtyRecord('document', docId, docId)),
    ),
    tx.done,
  ])
  announceDirty()
}

export async function putThread(record: ThreadRecord): Promise<void> {
  await putThreads([record])
}

/** Create a thread and its opening comment atomically. */
export async function createThread(
  thread: ThreadRecord,
  first: CommentRecord,
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['threads', 'comments', 'syncOutbox'], 'readwrite')
  await Promise.all([
    tx.objectStore('threads').put(thread),
    tx.objectStore('comments').put(first),
    tx.objectStore('syncOutbox').put(
      dirtyRecord('document', thread.docId, thread.docId),
    ),
    tx.done,
  ])
  announceDirty()
}

export async function putComment(comment: CommentRecord): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['comments', 'syncOutbox'], 'readwrite')
  await Promise.all([
    tx.objectStore('comments').put(comment),
    tx.objectStore('syncOutbox').put(
      dirtyRecord('document', comment.docId, comment.docId),
    ),
    tx.done,
  ])
  announceDirty()
}

export async function deleteComment(id: string): Promise<void> {
  const db = await getDB()
  const comment = await db.get('comments', id)
  if (!comment) return
  const tx = db.transaction(['comments', 'syncOutbox'], 'readwrite')
  await Promise.all([
    tx.objectStore('comments').delete(id),
    tx.objectStore('syncOutbox').put(
      dirtyRecord('document', comment.docId, comment.docId),
    ),
    tx.done,
  ])
  announceDirty()
}

/** Remove a thread and every comment on it in one transaction. */
export async function deleteThreadCascade(threadId: string): Promise<void> {
  const db = await getDB()
  const thread = await db.get('threads', threadId)
  if (!thread) return
  const tx = db.transaction(['threads', 'comments', 'syncOutbox'], 'readwrite')
  const commentStore = tx.objectStore('comments')

  const commentIds = await commentStore.index('by-threadId').getAllKeys(threadId)

  await Promise.all([
    tx.objectStore('threads').delete(threadId),
    ...commentIds.map(id => commentStore.delete(id)),
    tx.objectStore('syncOutbox').put(
      dirtyRecord('document', thread.docId, thread.docId),
    ),
    tx.done,
  ])
  announceDirty()
}
