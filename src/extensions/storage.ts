import { getDB } from '../db/client'
import { announceDirty, dirtyRecord } from '../sync/local'
import type {
  ExtensionDocumentStateRecord,
  ExtensionSettingsRecord,
} from '../types'

export async function getExtensionSettings<T = unknown>(
  extensionId: string,
): Promise<(Omit<ExtensionSettingsRecord, 'data'> & { data: T }) | undefined> {
  return (await getDB()).get('extensionSettings', extensionId) as Promise<
    (Omit<ExtensionSettingsRecord, 'data'> & { data: T }) | undefined
  >
}

export async function putExtensionSettings<T>(
  record: Omit<ExtensionSettingsRecord, 'data'> & { data: T },
): Promise<void> {
  await (await getDB()).put('extensionSettings', record)
}

export async function getExtensionDocumentState<T = unknown>(
  extensionId: string,
  documentId: string,
): Promise<
  | (Omit<ExtensionDocumentStateRecord, 'data'> & { data: T })
  | undefined
> {
  return (await getDB()).get('extensionDocumentState', [
    extensionId,
    documentId,
  ]) as Promise<
    | (Omit<ExtensionDocumentStateRecord, 'data'> & { data: T })
    | undefined
  >
}

export async function listExtensionDocumentStates(
  documentId: string,
): Promise<ExtensionDocumentStateRecord[]> {
  return (await getDB()).getAllFromIndex(
    'extensionDocumentState',
    'by-documentId',
    documentId,
  )
}

export async function putExtensionDocumentState<T>(
  record: Omit<ExtensionDocumentStateRecord, 'data'> & { data: T },
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(
    ['extensionDocumentState', 'syncOutbox'],
    'readwrite',
  )
  await Promise.all([
    tx.objectStore('extensionDocumentState').put(record),
    tx.objectStore('syncOutbox').put(
      dirtyRecord('document', record.documentId, record.documentId),
    ),
    tx.done,
  ])
  announceDirty()
}

export async function deleteExtensionDocumentState(
  extensionId: string,
  documentId: string,
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(
    ['extensionDocumentState', 'syncOutbox'],
    'readwrite',
  )
  await Promise.all([
    tx.objectStore('extensionDocumentState').delete([extensionId, documentId]),
    tx.objectStore('syncOutbox').put(
      dirtyRecord('document', documentId, documentId),
    ),
    tx.done,
  ])
  announceDirty()
}
