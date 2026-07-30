import { getDB } from '../db/client'
import type {
  AssetRecord,
  CommentRecord,
  SnapshotRecord,
  SyncedDocumentPackage,
  ThreadRecord,
} from '../types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export async function buildDocumentPackage(
  docId: string,
  changedAt: number,
  deviceLabel: string,
): Promise<SyncedDocumentPackage | null> {
  const db = await getDB()
  const tx = db.transaction(
    ['documents', 'threads', 'comments', 'snapshots', 'assets'],
    'readonly',
  )
  const [document, threads, comments, snapshots, assetIds] = await Promise.all([
    tx.objectStore('documents').get(docId),
    tx.objectStore('threads').index('by-docId').getAll(docId),
    tx.objectStore('comments').index('by-docId').getAll(docId),
    tx.objectStore('snapshots').index('by-docId').getAll(docId),
    tx.objectStore('assets').index('by-docId').getAllKeys(docId),
  ])
  await tx.done
  if (!document) return null
  return {
    schemaVersion: 1,
    document,
    threads,
    comments,
    snapshots,
    assetIds: assetIds.map(String),
    changedAt,
    deviceLabel,
  }
}

/** Replace a complete document graph without re-queueing it for upload. */
export async function applyDocumentPackage(
  package_: SyncedDocumentPackage,
): Promise<void> {
  if (package_.schemaVersion !== 1) throw new Error('Unsupported vault document')
  const docId = package_.document.id
  if (
    package_.threads.some(record => record.docId !== docId) ||
    package_.comments.some(record => record.docId !== docId) ||
    package_.snapshots.some(record => record.docId !== docId)
  ) {
    throw new Error('The encrypted document contains foreign sidecar records')
  }

  const db = await getDB()
  const tx = db.transaction(
    ['documents', 'threads', 'comments', 'snapshots'],
    'readwrite',
  )
  const [threadIds, commentIds, snapshotIds] = await Promise.all([
    tx.objectStore('threads').index('by-docId').getAllKeys(docId),
    tx.objectStore('comments').index('by-docId').getAllKeys(docId),
    tx.objectStore('snapshots').index('by-docId').getAllKeys(docId),
  ])
  await Promise.all([
    tx.objectStore('documents').put(package_.document),
    ...threadIds.map(id => tx.objectStore('threads').delete(id)),
    ...commentIds.map(id => tx.objectStore('comments').delete(id)),
    ...snapshotIds.map(id => tx.objectStore('snapshots').delete(id)),
    ...package_.threads.map((record: ThreadRecord) =>
      tx.objectStore('threads').put(record),
    ),
    ...package_.comments.map((record: CommentRecord) =>
      tx.objectStore('comments').put(record),
    ),
    ...package_.snapshots.map((record: SnapshotRecord) =>
      tx.objectStore('snapshots').put(record),
    ),
    tx.done,
  ])
}

/** Apply a permanent remote tombstone without creating a local echo. */
export async function applyRemoteDelete(docId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(
    ['documents', 'threads', 'comments', 'snapshots', 'assets'],
    'readwrite',
  )
  const [threadIds, commentIds, snapshotIds, assetIds] = await Promise.all([
    tx.objectStore('threads').index('by-docId').getAllKeys(docId),
    tx.objectStore('comments').index('by-docId').getAllKeys(docId),
    tx.objectStore('snapshots').index('by-docId').getAllKeys(docId),
    tx.objectStore('assets').index('by-docId').getAllKeys(docId),
  ])
  await Promise.all([
    tx.objectStore('documents').delete(docId),
    ...threadIds.map(id => tx.objectStore('threads').delete(id)),
    ...commentIds.map(id => tx.objectStore('comments').delete(id)),
    ...snapshotIds.map(id => tx.objectStore('snapshots').delete(id)),
    ...assetIds.map(id => tx.objectStore('assets').delete(id)),
    tx.done,
  ])
}

export function serializeAsset(asset: AssetRecord): Promise<Uint8Array> {
  return asset.blob.arrayBuffer().then(buffer => {
    const metadata = encoder.encode(
      JSON.stringify({
        schemaVersion: 1,
        id: asset.id,
        docId: asset.docId,
        mimeType: asset.mimeType,
        originalName: asset.originalName,
        storageName: asset.storageName,
        size: asset.size,
        createdAt: asset.createdAt,
      }),
    )
    const result = new Uint8Array(4 + metadata.length + buffer.byteLength)
    new DataView(result.buffer).setUint32(0, metadata.length)
    result.set(metadata, 4)
    result.set(new Uint8Array(buffer), 4 + metadata.length)
    return result
  })
}

export function deserializeAsset(bytes: Uint8Array): AssetRecord {
  if (bytes.length < 5) throw new Error('Incomplete encrypted asset')
  const metadataLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(0)
  if (metadataLength <= 0 || metadataLength > bytes.length - 4) {
    throw new Error('Invalid encrypted asset metadata')
  }
  const metadata = JSON.parse(
    decoder.decode(bytes.subarray(4, 4 + metadataLength)),
  ) as Omit<AssetRecord, 'blob'> & { schemaVersion: number }
  if (metadata.schemaVersion !== 1) throw new Error('Unsupported encrypted asset')
  const payload = bytes.slice(4 + metadataLength)
  if (payload.byteLength !== metadata.size) throw new Error('Encrypted asset size mismatch')
  return {
    id: metadata.id,
    docId: metadata.docId,
    mimeType: metadata.mimeType,
    originalName: metadata.originalName,
    storageName: metadata.storageName,
    size: metadata.size,
    createdAt: metadata.createdAt,
    blob: new Blob([payload], { type: metadata.mimeType }),
  }
}
