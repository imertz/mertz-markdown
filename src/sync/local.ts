import { getDB } from '../db/client'
import type {
  SyncConflictRecord,
  SyncObjectKind,
  SyncOutboxRecord,
  VaultConfigRecord,
} from '../types'
import { addSnapshot, pruneSnapshots } from '../db/snapshots'
import { createId } from '../lib/id'
import { SNAPSHOT_LIMIT } from '../lib/snapshotPolicy'
import { applyDocumentPackage } from './package'

export const SYNC_DIRTY_EVENT = 'mertz:sync-dirty'
export const SYNC_REMOTE_EVENT = 'mertz:sync-remote'

export const objectStateId = (kind: SyncObjectKind, objectId: string): string =>
  `${kind}:${objectId}`

export function dirtyRecord(
  kind: SyncObjectKind,
  objectId: string,
  docId: string,
  operation: 'put' | 'delete' = 'put',
  changedAt = Date.now(),
): SyncOutboxRecord {
  return {
    id: objectStateId(kind, objectId),
    kind,
    objectId,
    docId,
    operation,
    changedAt,
    attempts: 0,
    nextAttemptAt: changedAt,
  }
}

export function announceDirty(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SYNC_DIRTY_EVENT))
}

export async function getVaultConfig(): Promise<VaultConfigRecord | undefined> {
  return (await getDB()).get('vaultConfig', 'primary')
}

export async function putVaultConfig(config: VaultConfigRecord): Promise<void> {
  await (await getDB()).put('vaultConfig', config)
}

export async function clearVaultConfig(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(
    ['vaultConfig', 'syncObjects', 'syncOutbox', 'syncConflicts'],
    'readwrite',
  )
  await Promise.all([
    tx.objectStore('vaultConfig').clear(),
    tx.objectStore('syncObjects').clear(),
    tx.objectStore('syncOutbox').clear(),
    tx.objectStore('syncConflicts').clear(),
    tx.done,
  ])
}

export async function queueWholeLibrary(): Promise<void> {
  const db = await getDB()
  const [documents, assets] = await Promise.all([
    db.getAll('documents'),
    db.getAll('assets'),
  ])
  const tx = db.transaction('syncOutbox', 'readwrite')
  const now = Date.now()
  await Promise.all([
    ...assets.map(asset =>
      tx.store.put(dirtyRecord('asset', asset.id, asset.docId, 'put', now)),
    ),
    ...documents.map(document =>
      tx.store.put(dirtyRecord('document', document.id, document.id, 'put', now)),
    ),
    tx.done,
  ])
  announceDirty()
}

export async function listConflicts(docId: string): Promise<SyncConflictRecord[]> {
  const db = await getDB()
  const range = IDBKeyRange.bound([docId], [docId, []])
  const rows = await db.getAllFromIndex('syncConflicts', 'by-doc-createdAt', range)
  return rows.reverse()
}

export async function restoreConflict(record: SyncConflictRecord): Promise<void> {
  const db = await getDB()

  // Preserve the state being replaced before overwriting it. This is the only
  // restore point that matters: a caller-side snapshot swallows its own write
  // errors, so relying on one would let a failed snapshot pass for a taken one
  // and the overwrite would proceed with nothing to go back to. Failing here
  // aborts the restore instead, which is the safe direction.
  const current = await db.get('documents', record.docId)
  if (current) {
    await addSnapshot({
      id: createId(),
      docId: record.docId,
      doc: current.doc,
      markdown: current.markdown,
      title: current.title,
      createdAt: Date.now(),
      cause: 'restore',
    })
    await pruneSnapshots(record.docId, SNAPSHOT_LIMIT)
  }

  const currentSnapshots = await db.getAllFromIndex(
    'snapshots',
    'by-docId',
    record.docId,
  )
  const snapshots = [
    ...new Map(
      [...record.package.snapshots, ...currentSnapshots]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(snapshot => [snapshot.id, snapshot]),
    ).values(),
  ].slice(0, 50)
  await applyDocumentPackage({ ...record.package, snapshots })
  const restored = await db.get('documents', record.docId)
  if (!restored) throw new Error('The conflict document is missing')
  const changedAt = Date.now()
  restored.updatedAt = changedAt
  restored.deletedAt = null
  const tx = db.transaction(['documents', 'syncOutbox'], 'readwrite')
  await Promise.all([
    tx.objectStore('documents').put(restored),
    tx.objectStore('syncOutbox').put(
      dirtyRecord('document', record.docId, record.docId, 'put', changedAt),
    ),
    tx.done,
  ])
  announceDirty()
}
