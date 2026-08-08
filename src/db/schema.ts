import type { DBSchema } from 'idb'
import type {
  AssetRecord,
  CommentRecord,
  DocumentRecord,
  ExtensionDocumentStateRecord,
  ExtensionSettingsRecord,
  SnapshotRecord,
  SyncConflictRecord,
  SyncObjectStateRecord,
  SyncOutboxRecord,
  ThreadRecord,
  ThreadStatus,
  VaultConfigRecord,
} from '../types'

export const DB_NAME = 'mertz-markdown'
export const DB_VERSION = 5

/**
 * Safari can reject Blob/File structured clones during IndexedDB writes.
 * New records therefore persist owned bytes; `blob` remains optional solely
 * so databases created by earlier releases can be read and migrated lazily.
 */
export type StoredAssetRecord = Omit<AssetRecord, 'blob'> & {
  bytes?: ArrayBuffer
  blob?: Blob
}

export interface MertzDB extends DBSchema {
  extensionSettings: {
    key: string
    value: ExtensionSettingsRecord
  }
  extensionDocumentState: {
    key: [string, string]
    value: ExtensionDocumentStateRecord
    indexes: { 'by-documentId': string }
  }
  vaultConfig: {
    key: string
    value: VaultConfigRecord
  }
  syncOutbox: {
    key: string
    value: SyncOutboxRecord
    indexes: { 'by-nextAttemptAt': number }
  }
  syncObjects: {
    key: string
    value: SyncObjectStateRecord
  }
  syncConflicts: {
    key: string
    value: SyncConflictRecord
    indexes: { 'by-doc-createdAt': [string, number] }
  }
  assets: {
    key: string
    value: StoredAssetRecord
    indexes: { 'by-docId': string }
  }
  documents: {
    key: string
    value: DocumentRecord
    indexes: { 'by-updatedAt': number }
  }
  threads: {
    key: string
    value: ThreadRecord
    indexes: {
      'by-docId': string
      'by-doc-status': [string, ThreadStatus]
    }
  }
  comments: {
    key: string
    value: CommentRecord
    indexes: {
      'by-threadId': string
      'by-docId': string
    }
  }
  snapshots: {
    key: string
    value: SnapshotRecord
    indexes: {
      'by-docId': string
      /** Compound, so one document's history is a single ordered range scan. */
      'by-doc-createdAt': [string, number]
    }
  }
}
