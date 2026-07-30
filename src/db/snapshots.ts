import type { SnapshotRecord } from '../types'
import { announceDirty, dirtyRecord } from '../sync/local'
import { getDB } from './client'

/**
 * Every key in `by-doc-createdAt` belonging to one document.
 *
 * The upper bound is `[docId, []]` rather than a large number: IndexedDB sorts
 * arrays after every number, string and date, so this covers the whole range
 * without having to assume anything about how big a timestamp can get.
 */
const rangeFor = (docId: string): IDBKeyRange =>
  IDBKeyRange.bound([docId], [docId, []])

/** A document's snapshots, newest first. */
export async function listSnapshots(
  docId: string,
): Promise<SnapshotRecord[]> {
  const db = await getDB()
  const ordered = await db.getAllFromIndex(
    'snapshots',
    'by-doc-createdAt',
    rangeFor(docId),
  )
  return ordered.reverse()
}

export async function addSnapshot(record: SnapshotRecord): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['snapshots', 'syncOutbox'], 'readwrite')
  await Promise.all([
    tx.objectStore('snapshots').put(record),
    tx.objectStore('syncOutbox').put(
      dirtyRecord('document', record.docId, record.docId),
    ),
    tx.done,
  ])
  announceDirty()
}

/**
 * When the newest snapshot for a document was taken, or null if it has none.
 *
 * Walks the index backwards for a single key rather than loading the records:
 * this runs on every save, and each record carries a whole document.
 */
export async function latestSnapshotAt(docId: string): Promise<number | null> {
  const db = await getDB()
  const cursor = await db
    .transaction('snapshots')
    .store.index('by-doc-createdAt')
    .openKeyCursor(rangeFor(docId), 'prev')

  if (!cursor) return null
  return (cursor.key as [string, number])[1]
}

/** Drop all but the newest `limit` snapshots. Returns how many went. */
export async function pruneSnapshots(
  docId: string,
  limit: number,
): Promise<number> {
  const db = await getDB()
  const tx = db.transaction('snapshots', 'readwrite')
  const index = tx.store.index('by-doc-createdAt')

  // Oldest first, so the excess is the front of the list.
  const keys = await index.getAllKeys(rangeFor(docId))
  const excess = keys.slice(0, Math.max(0, keys.length - limit))

  await Promise.all([...excess.map(key => tx.store.delete(key)), tx.done])
  return excess.length
}
