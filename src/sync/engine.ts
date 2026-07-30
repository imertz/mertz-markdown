import { getDB } from '../db/client'
import { getAsset, putRemoteAsset } from '../db/assets'
import type {
  SyncConflictRecord,
  SyncObjectStateRecord,
  SyncOutboxRecord,
  SyncedDocumentPackage,
  VaultConfigRecord,
} from '../types'
import { SyncApiClient } from './api'
import { decryptBytes, decryptJson, encryptBytes, encryptJson } from './crypto'
import {
  announceDirty,
  getVaultConfig,
  objectStateId,
  putVaultConfig,
  SYNC_REMOTE_EVENT,
} from './local'
import {
  applyDocumentPackage,
  applyRemoteDelete,
  buildDocumentPackage,
  deserializeAsset,
  serializeAsset,
} from './package'
import type { RemoteChange, SyncStatus } from './types'

const CONFLICT_LIMIT = 50

export interface SyncEngineEvents {
  onStatus?: (status: SyncStatus, error?: string) => void
  onRemoteChange?: () => void | Promise<void>
}

export class VaultSyncEngine {
  private running: Promise<void> | null = null
  private rerunRequested = false

  constructor(private readonly events: SyncEngineEvents = {}) {}

  sync(): Promise<void> {
    if (this.running) {
      this.rerunRequested = true
      return this.running
    }
    this.running = this.runSerialized().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async runSerialized(): Promise<void> {
    const work = async () => {
      do {
        this.rerunRequested = false
        await this.run()
      } while (this.rerunRequested)
    }
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request('mertz-markdown:vault-sync', work)
    } else {
      await work()
    }
  }

  private async run(): Promise<void> {
    const config = await getVaultConfig()
    if (!config) {
      this.events.onStatus?.('disabled')
      return
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.events.onStatus?.('offline')
      return
    }

    this.events.onStatus?.('syncing')
    try {
      const api = new SyncApiClient({
        apiUrl: config.apiUrl,
        vaultId: config.vaultId,
        token: config.deviceToken,
      })
      await this.refreshClock(config, api)
      await this.push(config, api)
      const changed = await this.pull(config, api)
      this.events.onStatus?.('idle')
      if (changed) {
        window.dispatchEvent(new Event(SYNC_REMOTE_EVENT))
        await this.events.onRemoteChange?.()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed'
      console.error('[sync] failed', error)
      this.events.onStatus?.('error', message)
      throw error
    }
  }

  private async refreshClock(
    config: VaultConfigRecord,
    api: SyncApiClient,
  ): Promise<void> {
    const started = Date.now()
    const { serverTime } = await api.time()
    const midpoint = started + (Date.now() - started) / 2
    config.clockOffsetMs = Math.round(serverTime - midpoint)
    await putVaultConfig(config)
  }

  private async push(
    config: VaultConfigRecord,
    api: SyncApiClient,
  ): Promise<void> {
    const db = await getDB()
    const records = (await db.getAll('syncOutbox')).sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'asset' ? -1 : 1
      return a.changedAt - b.changedAt
    })
    for (const record of records) await this.pushOne(config, api, record)
  }

  private async pushOne(
    config: VaultConfigRecord,
    api: SyncApiClient,
    record: SyncOutboxRecord,
  ): Promise<void> {
    const db = await getDB()
    const stateId = objectStateId(record.kind, record.objectId)
    const state = await db.get('syncObjects', stateId)
    let ciphertext: Uint8Array<ArrayBuffer> = new Uint8Array()

    if (record.operation === 'put') {
      if (record.kind === 'asset') {
        const asset = await getAsset(record.objectId)
        if (!asset) {
          await db.delete('syncOutbox', record.id)
          return
        }
        ciphertext = await encryptBytes(
          await serializeAsset(asset),
          config.masterKey,
          config.vaultId,
          'asset',
          asset.id,
        )
      } else {
        const package_ = await buildDocumentPackage(
          record.docId,
          record.changedAt,
          config.deviceLabel,
        )
        if (!package_) {
          record.operation = 'delete'
        } else {
          ciphertext = await encryptJson(
            package_,
            config.masterKey,
            config.vaultId,
            'document',
            record.objectId,
          )
        }
      }
    }

    try {
      const result = await api.putObject(
        record.kind,
        record.objectId,
        record.docId,
        ciphertext,
        state?.revision ?? 0,
        record.changedAt + config.clockOffsetMs,
        record.operation,
        config.deviceLabel,
      )

      if (record.kind === 'document' && result.conflictRevision !== null) {
        await this.cacheConflict(config, api, record.docId, result.conflictRevision)
      }

      const objectState: SyncObjectStateRecord = {
        id: stateId,
        kind: record.kind,
        objectId: record.objectId,
        revision: result.headRevision,
        changedAt: record.changedAt,
        deleted: record.operation === 'delete' && result.winner === 'submitted',
      }
      await db.put('syncObjects', objectState)

      const latest = await db.get('syncOutbox', record.id)
      if (latest?.changedAt === record.changedAt) await db.delete('syncOutbox', record.id)

      if (result.winner === 'existing' && record.kind === 'document') {
        await this.applyRemoteObject(config, api, {
          seq: result.seq,
          kind: 'document',
          objectId: record.objectId,
          docId: record.docId,
          revision: result.headRevision,
          changedAt: record.changedAt,
          deleted: false,
          deviceLabel: 'Another device',
        })
      }
    } catch (error) {
      const current = await db.get('syncOutbox', record.id)
      if (current?.changedAt === record.changedAt) {
        current.attempts += 1
        current.nextAttemptAt = Date.now() + Math.min(300_000, 2 ** current.attempts * 1000)
        await db.put('syncOutbox', current)
      }
      throw error
    }
  }

  private async pull(
    config: VaultConfigRecord,
    api: SyncApiClient,
  ): Promise<boolean> {
    const response = await api.changes(config.cursor)
    const db = await getDB()
    let changed = false
    const ordered = [...response.changes].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'asset' ? -1 : 1
      return a.seq - b.seq
    })

    for (const remote of ordered) {
      const pending = await db.get('syncOutbox', objectStateId(remote.kind, remote.objectId))
      if (pending) continue
      const local = await db.get('syncObjects', objectStateId(remote.kind, remote.objectId))
      if ((local?.revision ?? 0) >= remote.revision) continue
      await this.applyRemoteObject(config, api, remote)
      const conflicts = remote.conflictRevisions ??
        (remote.conflictRevision ? [remote.conflictRevision] : [])
      for (const revision of conflicts) {
        await this.cacheConflict(config, api, remote.docId, revision)
      }
      changed = true
    }

    config.cursor = response.cursor
    config.clockOffsetMs = response.serverTime - Date.now()
    await putVaultConfig(config)
    return changed
  }

  private async applyRemoteObject(
    config: VaultConfigRecord,
    api: SyncApiClient,
    remote: RemoteChange,
  ): Promise<void> {
    const db = await getDB()
    if (remote.deleted && remote.kind === 'document') {
      await applyRemoteDelete(remote.docId)
    } else {
      const ciphertext = await api.getObject(remote.kind, remote.objectId, remote.revision)
      if (remote.kind === 'asset') {
        const bytes = await decryptBytes(
          ciphertext,
          config.masterKey,
          config.vaultId,
          'asset',
          remote.objectId,
        )
        await putRemoteAsset(deserializeAsset(bytes))
      } else {
        const package_ = await decryptJson<SyncedDocumentPackage>(
          ciphertext,
          config.masterKey,
          config.vaultId,
          'document',
          remote.objectId,
        )
        await applyDocumentPackage(package_)
      }
    }

    await db.put('syncObjects', {
      id: objectStateId(remote.kind, remote.objectId),
      kind: remote.kind,
      objectId: remote.objectId,
      revision: remote.revision,
      changedAt: remote.changedAt,
      deleted: remote.deleted,
    })
  }

  private async cacheConflict(
    config: VaultConfigRecord,
    api: SyncApiClient,
    docId: string,
    revision: number,
  ): Promise<void> {
    const db = await getDB()
    const id = `${docId}:${revision}`
    if (await db.get('syncConflicts', id)) return
    let ciphertext: Uint8Array
    try {
      ciphertext = await api.getObject('document', docId, revision)
    } catch (error) {
      // A losing permanent tombstone has no plaintext package to restore.
      if (error instanceof Error && error.message.includes('has no body')) return
      throw error
    }
    const package_ = await decryptJson<SyncedDocumentPackage>(
      ciphertext,
      config.masterKey,
      config.vaultId,
      'document',
      docId,
    )
    const record: SyncConflictRecord = {
      id,
      docId,
      revision,
      changedAt: package_.changedAt,
      deviceLabel: package_.deviceLabel,
      package: package_,
      createdAt: Date.now(),
    }
    await db.put('syncConflicts', record)

    const range = IDBKeyRange.bound([docId], [docId, []])
    const conflicts = await db.getAllKeysFromIndex(
      'syncConflicts',
      'by-doc-createdAt',
      range,
    )
    await Promise.all(
      conflicts.slice(0, Math.max(0, conflicts.length - CONFLICT_LIMIT)).map(key =>
        db.delete('syncConflicts', key),
      ),
    )
  }
}

export function signalSync(): void {
  announceDirty()
}
