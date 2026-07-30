import type { DocumentRecord } from '../types'
import { announceDirty, dirtyRecord } from '../sync/local'
import { getDB } from './client'

/** How long a trashed document is kept before it is purged for good. */
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Live documents, most recently updated first. */
export async function listDocuments(): Promise<DocumentRecord[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('documents', 'by-updatedAt')
  return all.filter(d => d.deletedAt === null).reverse()
}

/** Trashed documents, most recently deleted first. */
export async function listTrashedDocuments(): Promise<DocumentRecord[]> {
  const db = await getDB()
  const all = await db.getAll('documents')
  return all
    .filter(d => d.deletedAt !== null)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
}

export async function getDocument(
  id: string,
): Promise<DocumentRecord | undefined> {
  return (await getDB()).get('documents', id)
}

export async function putDocument(doc: DocumentRecord): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['documents', 'syncOutbox'], 'readwrite')
  await Promise.all([
    tx.objectStore('documents').put(doc),
    tx.objectStore('syncOutbox').put(dirtyRecord('document', doc.id, doc.id)),
    tx.done,
  ])
  announceDirty()
}

/**
 * Move a document to the trash.
 *
 * Only the tombstone changes — the threads, comments and snapshots hanging off
 * it are untouched, which is what makes restoring bring the document back
 * whole rather than as a stripped copy of itself.
 *
 * `updatedAt` is deliberately left alone: deleting is not editing, and bumping
 * it would silently reorder the document to the top of the list on restore.
 */
export async function softDeleteDocument(
  id: string,
  now = Date.now(),
): Promise<DocumentRecord | undefined> {
  const db = await getDB()
  const existing = await db.get('documents', id)
  if (!existing) return undefined

  const record: DocumentRecord = { ...existing, deletedAt: now }
  const tx = db.transaction(['documents', 'syncOutbox'], 'readwrite')
  await Promise.all([
    tx.objectStore('documents').put(record),
    tx.objectStore('syncOutbox').put(
      dirtyRecord('document', id, id, 'put', now),
    ),
    tx.done,
  ])
  announceDirty()
  return record
}

export async function restoreDocument(
  id: string,
): Promise<DocumentRecord | undefined> {
  const db = await getDB()
  const existing = await db.get('documents', id)
  if (!existing) return undefined

  const record: DocumentRecord = { ...existing, deletedAt: null }
  const tx = db.transaction(['documents', 'syncOutbox'], 'readwrite')
  await Promise.all([
    tx.objectStore('documents').put(record),
    tx.objectStore('syncOutbox').put(dirtyRecord('document', id, id)),
    tx.done,
  ])
  announceDirty()
  return record
}

/** Purge trashed documents past the TTL. Returns how many were destroyed. */
export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  const expired = (await listTrashedDocuments()).filter(
    record => record.deletedAt !== null && now - record.deletedAt >= TRASH_TTL_MS,
  )

  for (const record of expired) await deleteDocumentCascade(record.id)
  return expired.length
}

/**
 * Remove a document and everything anchored to it in one transaction, so a
 * failure part-way through cannot leave threads pointing at a missing doc.
 *
 * Every promise awaited here belongs to the same idb transaction — an IndexedDB
 * transaction auto-closes as soon as the microtask queue drains, so awaiting
 * anything foreign in the middle would kill it.
 */
export async function deleteDocumentCascade(docId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(
    ['documents', 'threads', 'comments', 'snapshots', 'assets', 'syncOutbox'],
    'readwrite',
  )

  const threadStore = tx.objectStore('threads')
  const commentStore = tx.objectStore('comments')
  const snapshotStore = tx.objectStore('snapshots')
  const assetStore = tx.objectStore('assets')

  const [threadIds, commentIds, snapshotIds, assetIds] = await Promise.all([
    threadStore.index('by-docId').getAllKeys(docId),
    commentStore.index('by-docId').getAllKeys(docId),
    snapshotStore.index('by-docId').getAllKeys(docId),
    assetStore.index('by-docId').getAllKeys(docId),
  ])

  await Promise.all([
    tx.objectStore('documents').delete(docId),
    ...threadIds.map(id => threadStore.delete(id)),
    ...commentIds.map(id => commentStore.delete(id)),
    ...snapshotIds.map(id => snapshotStore.delete(id)),
    ...assetIds.map(id => assetStore.delete(id)),
    tx.objectStore('syncOutbox').put(
      dirtyRecord('document', docId, docId, 'delete'),
    ),
    ...assetIds.map(id => tx.objectStore('syncOutbox').delete(`asset:${String(id)}`)),
    tx.done,
  ])
  announceDirty()
}
