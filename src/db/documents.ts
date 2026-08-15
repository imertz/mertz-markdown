import type { DocumentRecord } from '../types'
import { foldLabel, normalizeTags } from '../lib/labels'
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

/*
 * Projects and tags.
 *
 * Neither has a store of its own: the project is a name on the document and the
 * tags are a list on it, so the catalogue is whatever the documents happen to
 * be carrying (see `src/lib/library.ts`). That is what lets both ride inside the
 * existing encrypted document package with no new sync object kind.
 *
 * Every writer below leaves `updatedAt` alone, for the reason the rename path in
 * `useDocuments` gives: the list is ordered by it, and re-filing a document from
 * inside that list would make the row jump out from under the pointer that just
 * filed it. Filing is not editing.
 */

/** File a document under a project. `null` unfiles it. */
export async function setDocumentProject(
  id: string,
  project: string | null,
): Promise<DocumentRecord | undefined> {
  const db = await getDB()
  const existing = await db.get('documents', id)
  if (!existing) return undefined

  const record: DocumentRecord = { ...existing, project }
  await putDocument(record)
  return record
}

/** Replace a document's tags wholesale; the list is normalised on the way in. */
export async function setDocumentTags(
  id: string,
  tags: readonly string[],
): Promise<DocumentRecord | undefined> {
  const db = await getDB()
  const existing = await db.get('documents', id)
  if (!existing) return undefined

  const record: DocumentRecord = { ...existing, tags: normalizeTags(tags) }
  await putDocument(record)
  return record
}

/**
 * Rename a project across every document filed under it; `null` unfiles them all.
 * Returns how many documents were rewritten.
 *
 * One transaction, on the same reasoning as `deleteDocumentCascade` below: every
 * promise awaited here belongs to it, because an IndexedDB transaction
 * auto-closes as soon as the microtask queue drains.
 *
 * Trashed documents are rewritten too. They keep their project so that restoring
 * one puts it back where it was, and skipping them here would strand it under a
 * name nothing else uses.
 */
export async function renameProject(
  from: string,
  to: string | null,
): Promise<number> {
  const db = await getDB()
  const tx = db.transaction(['documents', 'syncOutbox'], 'readwrite')
  const store = tx.objectStore('documents')
  const outbox = tx.objectStore('syncOutbox')

  const key = foldLabel(from)
  const matching = (await store.getAll()).filter(
    record => record.project && foldLabel(record.project) === key,
  )

  // One outbox entry per document, because there is no project object to
  // upload — the whole point of deriving the project list rather than storing it.
  await Promise.all([
    ...matching.flatMap(record => [
      store.put({ ...record, project: to }),
      outbox.put(dirtyRecord('document', record.id, record.id)),
    ]),
    tx.done,
  ])

  if (matching.length) announceDirty()
  return matching.length
}

/**
 * Rename a tag everywhere it appears; `null` removes it. Returns how many
 * documents were rewritten.
 */
export async function renameTag(from: string, to: string | null): Promise<number> {
  const db = await getDB()
  const tx = db.transaction(['documents', 'syncOutbox'], 'readwrite')
  const store = tx.objectStore('documents')
  const outbox = tx.objectStore('syncOutbox')

  const key = foldLabel(from)
  const updated = (await store.getAll()).flatMap(record => {
    const tags = record.tags ?? []
    if (!tags.some(tag => foldLabel(tag) === key)) return []
    // Renaming onto a tag the document already carries merges the two rather
    // than listing it twice. The new name goes last deliberately: `normalizeTags`
    // deduplicates first-spelling-wins, so a document that already said `wip`
    // keeps saying `wip` rather than being restyled to `WIP` by a rename it was
    // only incidentally caught up in.
    const kept = tags.filter(tag => foldLabel(tag) !== key)
    const next = normalizeTags(to ? [...kept, to] : kept)
    return [{ ...record, tags: next }]
  })

  await Promise.all([
    ...updated.flatMap(record => [
      store.put(record),
      outbox.put(dirtyRecord('document', record.id, record.id)),
    ]),
    tx.done,
  ])

  if (updated.length) announceDirty()
  return updated.length
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
    [
      'documents',
      'threads',
      'comments',
      'snapshots',
      'assets',
      'extensionDocumentState',
      'syncOutbox',
    ],
    'readwrite',
  )

  const threadStore = tx.objectStore('threads')
  const commentStore = tx.objectStore('comments')
  const snapshotStore = tx.objectStore('snapshots')
  const assetStore = tx.objectStore('assets')
  const extensionStore = tx.objectStore('extensionDocumentState')

  const [threadIds, commentIds, snapshotIds, assetIds, extensionStateIds] = await Promise.all([
    threadStore.index('by-docId').getAllKeys(docId),
    commentStore.index('by-docId').getAllKeys(docId),
    snapshotStore.index('by-docId').getAllKeys(docId),
    assetStore.index('by-docId').getAllKeys(docId),
    extensionStore.index('by-documentId').getAllKeys(docId),
  ])

  await Promise.all([
    tx.objectStore('documents').delete(docId),
    ...threadIds.map(id => threadStore.delete(id)),
    ...commentIds.map(id => commentStore.delete(id)),
    ...snapshotIds.map(id => snapshotStore.delete(id)),
    ...assetIds.map(id => assetStore.delete(id)),
    ...extensionStateIds.map(id => extensionStore.delete(id)),
    tx.objectStore('syncOutbox').put(
      dirtyRecord('document', docId, docId, 'delete'),
    ),
    ...assetIds.map(id => tx.objectStore('syncOutbox').delete(`asset:${String(id)}`)),
    tx.done,
  ])
  announceDirty()
}
