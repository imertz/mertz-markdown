import type { AssetRecord, DocumentRecord } from '../types'
import { getDB } from './client'

export async function getAsset(
  assetId: string,
): Promise<AssetRecord | undefined> {
  return (await getDB()).get('assets', assetId)
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
  return (await getDB()).getAllFromIndex('assets', 'by-docId', docId)
}

export async function putAssets(records: readonly AssetRecord[]): Promise<void> {
  if (!records.length) return
  const db = await getDB()
  const tx = db.transaction('assets', 'readwrite')
  await Promise.all([...records.map(record => tx.store.put(record)), tx.done])
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
  const db = await getDB()
  const tx = db.transaction(['documents', 'assets'], 'readwrite')
  await Promise.all([
    tx.objectStore('documents').put(document),
    ...assets.map(asset => tx.objectStore('assets').put(asset)),
    tx.done,
  ])
}
