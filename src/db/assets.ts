import type { AssetRecord, DocumentRecord } from '../types'
import { getDB } from './client'
import type { StoredAssetRecord } from './schema'

async function toStoredAsset(record: AssetRecord): Promise<StoredAssetRecord> {
  const { blob, ...metadata } = record
  return { ...metadata, bytes: await blob.arrayBuffer() }
}

function fromStoredAsset(record: StoredAssetRecord): AssetRecord {
  const { bytes, blob: legacyBlob, ...metadata } = record
  const blob =
    legacyBlob ?? (bytes ? new Blob([bytes], { type: metadata.mimeType }) : null)
  if (!blob) throw new Error(`Image ${record.id} has no stored payload`)
  return { ...metadata, blob }
}

export async function getAsset(
  assetId: string,
): Promise<AssetRecord | undefined> {
  const stored = await (await getDB()).get('assets', assetId)
  return stored ? fromStoredAsset(stored) : undefined
}

/** Resolve an image without allowing a copied foreign-document id to leak. */
export async function getDocumentAsset(
  docId: string,
  assetId: string,
): Promise<AssetRecord | undefined> {
  const asset = await getAsset(assetId)
  return asset?.docId === docId ? asset : undefined
}

export async function listDocumentAssets(
  docId: string,
): Promise<AssetRecord[]> {
  const stored = await (await getDB()).getAllFromIndex(
    'assets',
    'by-docId',
    docId,
  )
  return stored.map(fromStoredAsset)
}

export async function putAssets(records: readonly AssetRecord[]): Promise<void> {
  if (!records.length) return
  const stored = await Promise.all(records.map(toStoredAsset))
  const db = await getDB()
  const tx = db.transaction('assets', 'readwrite')
  await Promise.all([...stored.map(record => tx.store.put(record)), tx.done])
}

export async function deleteAssets(assetIds: readonly string[]): Promise<void> {
  if (!assetIds.length) return
  const db = await getDB()
  const tx = db.transaction('assets', 'readwrite')
  await Promise.all([...assetIds.map(id => tx.store.delete(id)), tx.done])
}

/**
 * A bundle import becomes visible atomically with every blob it references.
 * Otherwise a quota failure halfway through could open a permanently broken
 * document even though the caller did everything in the right order.
 */
export async function putDocumentWithAssets(
  document: DocumentRecord,
  assets: readonly AssetRecord[],
): Promise<void> {
  const stored = await Promise.all(assets.map(toStoredAsset))
  const db = await getDB()
  const tx = db.transaction(['documents', 'assets'], 'readwrite')
  await Promise.all([
    tx.objectStore('documents').put(document),
    ...stored.map(asset => tx.objectStore('assets').put(asset)),
    tx.done,
  ])
}
