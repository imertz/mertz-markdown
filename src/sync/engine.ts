import { getDB } from '../db/client'
import { deleteRemoteAssets, getAsset, putRemoteAsset } from '../db/assets'
import type {
  SyncConflictRecord,
  SyncObjectStateRecord,
  SyncOutboxRecord,
  SyncedDocumentPackage,
  VaultConfigRecord,
} from '../types'
import { SyncApiClient, SyncRequestError } from './api'
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
const VAULT_FORGOTTEN = 'VAULT_FORGOTTEN'

/**
 * One remote object this device refuses to apply, and never will.
 *
 * Kept separate from ordinary failures because the two need opposite handling.
 * A transient failure must leave the cursor where it is so the change is
 * retried; a permanently unusable object must be stepped over, or a single
 * bad envelope from a compromised device would stall every later change in
 * the vault forever.
 */
export class RejectedRemoteObject extends Error {
  constructor(
    message: string,
    readonly kind: string,
    readonly objectId: string,
  ) {
    super(message)
    this.name = 'RejectedRemoteObject'
  }
}

export interface SyncEngineEvents {
  onStatus?: (status: SyncStatus, error?: string) => void
  onBeforeRemoteBatch?: () => void | Promise<void>
  onRemoteChange?: () => void | Promise<void>
  onAfterRemoteBatch?: () => void | Promise<void>
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
      if (!(await this.configStillCurrent(config))) {
        this.events.onStatus?.('disabled')
        return
      }
      await this.push(config, api)
      await this.pull(config, api)
      this.events.onStatus?.('idle')
    } catch (error) {
      if (error instanceof Error && error.message === VAULT_FORGOTTEN) {
        this.events.onStatus?.('disabled')
        return
      }
      const message = error instanceof Error ? error.message : 'Sync failed'
      console.error('[sync] failed', error)
      this.events.onStatus?.('error', message)
      throw error
    }
  }

  /**
   * Whether the config captured at the start of a run is still the config in
   * storage. A "forget this computer" clears vaultConfig while a sync is in
   * flight; without this check the run would re-persist the wiped credentials.
   */
  private async configStillCurrent(config: VaultConfigRecord): Promise<boolean> {
    const latest = await getVaultConfig()
    return Boolean(
      latest &&
        latest.vaultId === config.vaultId &&
        latest.deviceToken === config.deviceToken,
    )
  }

  private async refreshClock(
    config: VaultConfigRecord,
    api: SyncApiClient,
  ): Promise<void> {
    const started = Date.now()
    const { serverTime } = await api.time()
    const midpoint = started + (Date.now() - started) / 2
    config.clockOffsetMs = Math.round(serverTime - midpoint)
    if (await this.configStillCurrent(config)) {
      await putVaultConfig(config)
    } else {
      throw new Error(VAULT_FORGOTTEN)
    }
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
    let documentPackage: SyncedDocumentPackage | null = null

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
          documentPackage = package_
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

      // A delete of an object the server has never seen is intentionally a
      // successful no-op. Do not manufacture revision-zero local state or try
      // to fetch a revision-zero winner; just retire the matching outbox item.
      if (result.noOp || result.headRevision === 0) {
        const latest = await db.get('syncOutbox', record.id)
        if (latest?.changedAt === record.changedAt) {
          await db.delete('syncOutbox', record.id)
        }
        await db.delete('syncObjects', stateId)
        return
      }

      // When this exact submitted document loses, preserve the package already
      // in memory instead of racing a GET for a revision the server may prune.
      if (
        record.kind === 'document' &&
        documentPackage &&
        result.winner === 'existing' &&
        result.conflictRevision === result.revision
      ) {
        await this.storeConflictPackage(
          record.objectId,
          result.revision,
          documentPackage,
        )
      }

      const latest = await db.get('syncOutbox', record.id)
      const submittedWorkIsCurrent = latest?.changedAt === record.changedAt
      if (submittedWorkIsCurrent) await db.delete('syncOutbox', record.id)

      // A PUT response is metadata, not an atomic snapshot of the head body:
      // another writer can supersede and prune that revision before a follow-up
      // GET. Let the immediately following changes pull apply the authoritative
      // head (including tombstones) instead of fabricating deleted:false and
      // turning a harmless race into a permanently retried upload storm.
      if (result.winner === 'existing' && record.kind === 'document') {
        if (submittedWorkIsCurrent) await db.delete('syncObjects', stateId)
        return
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

    const hasRemoteBatch = ordered.length > 0
    try {
      if (hasRemoteBatch) await this.events.onBeforeRemoteBatch?.()

      for (const remote of ordered) {
        try {
          // The compacted feed can add a losing conflict while leaving the
          // winning head revision unchanged. Cache conflicts before the local
          // revision short-circuit so that information is never skipped.
          if (remote.kind === 'document') {
            const conflicts = remote.conflictRevisions ??
              (remote.conflictRevision ? [remote.conflictRevision] : [])
            for (const revision of new Set(conflicts)) {
              await this.cacheConflictSafely(
                config,
                api,
                remote.objectId,
                revision,
              )
            }
          }

          // onBeforeRemoteBatch flushes the live editor. Re-read the outbox
          // only afterwards so keystrokes that landed during the request are
          // treated as pending local work and cannot be overwritten.
          const pending = await db.get(
            'syncOutbox',
            objectStateId(remote.kind, remote.objectId),
          )
          if (pending) continue
          const local = await db.get(
            'syncObjects',
            objectStateId(remote.kind, remote.objectId),
          )
          if ((local?.revision ?? 0) >= remote.revision) continue

          await this.applyRemoteObject(config, api, remote)
        } catch (error) {
          // Step over an object this device will never be able to apply and keep
          // draining the feed. Deliberately no `syncObjects` write: the cursor
          // moves past this revision, so a later legitimate one still applies.
          if (error instanceof RejectedRemoteObject) {
            console.warn('[sync] skipped an unusable remote object', {
              kind: error.kind,
              objectId: error.objectId,
              reason: error.message,
            })
            continue
          }
          throw error
        }
        changed = true
      }

      config.cursor = response.cursor
      config.clockOffsetMs = response.serverTime - Date.now()
      if (await this.configStillCurrent(config)) {
        await putVaultConfig(config)
      }
      if (changed) {
        window.dispatchEvent(new Event(SYNC_REMOTE_EVENT))
        await this.events.onRemoteChange?.()
      }
      return changed
    } finally {
      if (hasRemoteBatch) await this.events.onAfterRemoteBatch?.()
    }
  }

  private async applyRemoteObject(
    config: VaultConfigRecord,
    api: SyncApiClient,
    remote: RemoteChange,
  ): Promise<void> {
    const db = await getDB()
    if (remote.kind === 'document' && remote.docId !== remote.objectId) {
      throw new RejectedRemoteObject(
        'The document metadata identity does not match its storage key',
        remote.kind,
        remote.objectId,
      )
    }
    if (remote.deleted) {
      // A tombstone has no body to fetch. Assets need this branch as much as
      // documents do: asking the server for a deleted revision answers 404,
      // and before this every asset tombstone aborted the pull and pinned the
      // cursor, taking the whole vault's sync down with it.
      if (remote.kind === 'document') await applyRemoteDelete(remote.docId)
      else await deleteRemoteAssets([remote.objectId])
    } else {
      const ciphertext = await this.fetchObject(api, remote)
      if (remote.kind === 'asset') {
        const bytes = await decryptBytes(
          ciphertext,
          config.masterKey,
          config.vaultId,
          'asset',
          remote.objectId,
        )
        const asset = deserializeAsset(bytes)
        // The envelope carries its own identity; it must match the object key
        // it was stored and encrypted under, or one device's sync state and
        // another's local records would diverge on the same object.
        if (asset.id !== remote.objectId || asset.docId !== remote.docId) {
          throw new RejectedRemoteObject(
            'The encrypted asset identity does not match its storage key',
            remote.kind,
            remote.objectId,
          )
        }
        await putRemoteAsset(asset)
      } else {
        const package_ = await decryptJson<SyncedDocumentPackage>(
          ciphertext,
          config.masterKey,
          config.vaultId,
          'document',
          remote.objectId,
        )
        if (package_.document.id !== remote.objectId) {
          throw new RejectedRemoteObject(
            'The encrypted document identity does not match its storage key',
            remote.kind,
            remote.objectId,
          )
        }
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

  /**
   * Download one object's ciphertext.
   *
   * A 404 is the server's final answer about this revision: the body was
   * pruned, or the change feed named something the object store never held.
   * Any other failure may well succeed on the next attempt, so it stays an
   * ordinary error and leaves the cursor where it is.
   */
  private async fetchObject(
    api: SyncApiClient,
    remote: RemoteChange,
  ): Promise<Uint8Array> {
    try {
      return await api.getObject(remote.kind, remote.objectId, remote.revision)
    } catch (error) {
      if (error instanceof SyncRequestError && error.status === 404) {
        throw new RejectedRemoteObject(error.message, remote.kind, remote.objectId)
      }
      throw error
    }
  }

  private async cacheConflict(
    config: VaultConfigRecord,
    api: SyncApiClient,
    objectId: string,
    revision: number,
  ): Promise<void> {
    const db = await getDB()
    const id = `${objectId}:${revision}`
    if (await db.get('syncConflicts', id)) return
    let ciphertext: Uint8Array
    try {
      ciphertext = await api.getObject('document', objectId, revision)
    } catch (error) {
      // A losing permanent tombstone has no plaintext package to restore.
      if (error instanceof SyncRequestError && error.status === 404) return
      throw error
    }
    const package_ = await decryptJson<SyncedDocumentPackage>(
      ciphertext,
      config.masterKey,
      config.vaultId,
      'document',
      objectId,
    )
    if (package_.document.id !== objectId) {
      throw new RejectedRemoteObject(
        'The conflicting document identity does not match its storage key',
        'document',
        objectId,
      )
    }
    await this.storeConflictPackage(objectId, revision, package_)
  }

  private async storeConflictPackage(
    objectId: string,
    revision: number,
    package_: SyncedDocumentPackage,
  ): Promise<void> {
    if (package_.document.id !== objectId) {
      throw new RejectedRemoteObject(
        'The conflicting document identity does not match its storage key',
        'document',
        objectId,
      )
    }
    const db = await getDB()
    const id = `${objectId}:${revision}`
    if (await db.get('syncConflicts', id)) return
    const record: SyncConflictRecord = {
      id,
      docId: objectId,
      revision,
      changedAt: package_.changedAt,
      deviceLabel: package_.deviceLabel,
      package: package_,
      createdAt: Date.now(),
    }
    await db.put('syncConflicts', record)

    const range = IDBKeyRange.bound([objectId], [objectId, []])
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

  /** Ignore permanently malformed/pruned conflicts, but retry transient I/O. */
  private async cacheConflictSafely(
    config: VaultConfigRecord,
    api: SyncApiClient,
    objectId: string,
    revision: number,
  ): Promise<void> {
    try {
      await this.cacheConflict(config, api, objectId, revision)
    } catch (error) {
      if (!(error instanceof RejectedRemoteObject)) throw error
      console.warn('[sync] skipped an unusable conflict', {
        kind: error.kind,
        objectId: error.objectId,
        revision,
        reason: error.message,
      })
    }
  }
}

export function signalSync(): void {
  announceDirty()
}
