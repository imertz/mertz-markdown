import type { SyncedDocumentPackage, SyncObjectKind } from '../types'

export const DEFAULT_SYNC_API = 'https://sync.markdown.mysolon.gr'
export const VAULT_ROUTE = /^\/v\/([A-Za-z0-9_-]{16,64})\/?$/

export interface RemoteChange {
  seq: number
  kind: SyncObjectKind
  objectId: string
  docId: string
  revision: number
  changedAt: number
  deleted: boolean
  conflictRevision?: number | null
  conflictRevisions?: number[]
  deviceLabel: string
}

export interface ChangesResponse {
  changes: RemoteChange[]
  cursor: number
  serverTime: number
}

export interface UploadResponse {
  revision: number
  headRevision: number
  winner: 'submitted' | 'existing'
  conflictRevision: number | null
  seq: number
  /** The submitted delete named an object that has never existed. */
  noOp?: boolean
}

export interface PairingClaimResponse {
  vaultId: string
  deviceId: string
  deviceToken: string
  deviceLabel: string
  wrappedKey: string
}

export interface VaultDevice {
  id: string
  label: string
  createdAt: number
  lastSeenAt: number
  current: boolean
}

/**
 * Server-side vault occupancy. Distinct from `navigator.storage.estimate()`,
 * which measures this browser's whole origin: the quota that can actually
 * reject a write lives on the server, so the number shown next to it has to
 * come from there too.
 */
export interface VaultUsage {
  bytes: number
  quotaBytes: number
}

export type SyncStatus =
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'error'

export interface ConflictView {
  id: string
  docId: string
  revision: number
  changedAt: number
  deviceLabel: string
  package: SyncedDocumentPackage
}
