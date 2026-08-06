import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAsset, putRemoteAsset } from '../db/assets'
import { getDB } from '../db/client'
import { putDocument } from '../db/documents'
import { createThread, loadThreadsForDoc } from '../db/threads'
import {
  clearVaultConfig,
  dirtyRecord,
  getVaultConfig,
  putVaultConfig,
} from '../sync/local'
import { VaultSyncEngine } from '../sync/engine'
import { encryptJson } from '../sync/crypto'
import type { SyncedDocumentPackage, VaultConfigRecord } from '../types'
import {
  makeComment,
  makeDocument,
  makeThread,
  resetDatabase,
} from './dbHarness'

beforeEach(resetDatabase)
afterEach(() => vi.unstubAllGlobals())

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const octet = (bytes: Uint8Array<ArrayBuffer>): Response =>
  new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream' },
  })

function makeVaultConfig(): VaultConfigRecord {
  return {
    id: 'primary',
    vaultId: 'vault-abc',
    masterKey: crypto.getRandomValues(new Uint8Array(32)).buffer,
    deviceId: 'device-1',
    deviceToken: 'token-1',
    deviceLabel: 'Test browser',
    apiUrl: 'https://sync.example',
    cursor: 0,
    clockOffsetMs: 0,
    createdAt: Date.now(),
  }
}

describe('vault sync engine', () => {
  it('keeps credentials wiped when forget lands mid-sync', async () => {
    const config = makeVaultConfig()
    await putVaultConfig(config)

    let releaseTime!: (value: Response) => void
    const timeGate = new Promise<Response>(resolve => {
      releaseTime = resolve
    })
    const fetch_ = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/v1/time')) return await timeGate
      return json({ changes: [], cursor: 0, serverTime: Date.now() })
    })
    vi.stubGlobal('fetch', fetch_)

    const engine = new VaultSyncEngine()
    const syncPromise = engine.sync()

    // The sync reaches the in-flight clock request.
    await vi.waitFor(() => {
      expect(
        fetch_.mock.calls.some(([input]) => String(input).endsWith('/v1/time')),
      ).toBe(true)
    })

    await clearVaultConfig()
    expect(await getVaultConfig()).toBeUndefined()

    releaseTime(json({ serverTime: Date.now() }))
    await syncPromise

    // The run captured `config` before the wipe and later persists it again to
    // record the clock offset and cursor. Without a re-read at each of those
    // writes it would put the master key and device token straight back.
    expect(await getVaultConfig()).toBeUndefined()
  })

  it('applies a stale winning head that silently drops a local thread', async () => {
    const config = makeVaultConfig()
    await putVaultConfig(config)

    const document = makeDocument({ markdown: 'with a comment\n' })
    const thread = makeThread(document.id)
    const comment = makeComment(thread.id, document.id)
    await putDocument(document)
    await createThread(thread, comment)
    expect((await loadThreadsForDoc(document.id)).length).toBe(1)

    // The winning remote head was built before this device added the thread.
    const remoteHead: SyncedDocumentPackage = {
      schemaVersion: 1,
      document: { ...document, updatedAt: 10 },
      threads: [],
      comments: [],
      snapshots: [],
      assetIds: [],
      changedAt: 10,
      deviceLabel: 'Laptop',
    }
    const ciphertext = await encryptJson(
      remoteHead,
      new Uint8Array(config.masterKey),
      config.vaultId,
      'document',
      document.id,
    )

    const fetch_ = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/v1/time')) return json({ serverTime: Date.now() })
      if (url.includes('/changes')) {
        return json({ changes: [], cursor: 0, serverTime: Date.now() })
      }
      if (init?.method === 'PUT' && url.includes('/objects/document/')) {
        return json({
          revision: 2,
          headRevision: 2,
          winner: 'existing',
          conflictRevision: 1,
          seq: 1,
        })
      }
      if (url.includes('/objects/document/')) {
        return octet(ciphertext)
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch_)

    const engine = new VaultSyncEngine()
    await engine.sync()

    // The locally authored thread vanished from the live document.
    expect((await loadThreadsForDoc(document.id)).length).toBe(0)
    const db = await getDB()
    expect(await db.count('syncConflicts')).toBeGreaterThan(0)
  })

  it('skips a remote document whose envelope id does not match its storage key', async () => {
    const config = makeVaultConfig()
    await putVaultConfig(config)

    const document = makeDocument({ markdown: 'tampered\n' })
    const tampered: SyncedDocumentPackage = {
      schemaVersion: 1,
      document,
      threads: [],
      comments: [],
      snapshots: [],
      assetIds: [],
      changedAt: 10,
      deviceLabel: 'Rogue',
    }
    // Encrypted under the storage key, but the envelope names a different id.
    const ciphertext = await encryptJson(
      tampered,
      new Uint8Array(config.masterKey),
      config.vaultId,
      'document',
      'other-doc',
    )

    const fetch_ = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/v1/time')) return json({ serverTime: Date.now() })
      if (url.includes('/changes')) {
        return json({
          changes: [
            {
              seq: 1,
              kind: 'document',
              objectId: 'other-doc',
              docId: 'other-doc',
              revision: 1,
              changedAt: 10,
              deleted: false,
              deviceLabel: 'Rogue',
            },
          ],
          cursor: 1,
          serverTime: Date.now(),
        })
      }
      return octet(ciphertext)
    })
    vi.stubGlobal('fetch', fetch_)

    const engine = new VaultSyncEngine()
    await engine.sync()

    const db = await getDB()
    expect(await db.get('documents', 'other-doc')).toBeUndefined()
    expect(await db.get('documents', document.id)).toBeUndefined()

    // Stepped over rather than thrown out of: the cursor still advances, so one
    // object a compromised device can author cannot stall the whole vault.
    expect((await getVaultConfig())?.cursor).toBe(1)
  })

  /**
   * Asset tombstones have no body. Fetching one answers 404, and while that
   * escaped `pull()` as an ordinary error the cursor stayed put — so a single
   * deleted asset took down every later change in the vault, permanently.
   */
  it('applies an asset tombstone without stalling the cursor', async () => {
    const config = makeVaultConfig()
    await putVaultConfig(config)

    const document = makeDocument({ markdown: 'has an image\n' })
    await putDocument(document)
    await putRemoteAsset({
      id: 'asset-1',
      docId: document.id,
      mimeType: 'image/png',
      originalName: 'pic.png',
      storageName: 'pic.png',
      size: 3,
      createdAt: 1,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    })
    expect(await getAsset('asset-1')).toBeTruthy()

    const fetch_ = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/v1/time')) return json({ serverTime: Date.now() })
      if (init?.method === 'PUT') {
        return json({
          revision: 1,
          headRevision: 1,
          winner: 'submitted',
          conflictRevision: null,
          seq: 1,
        })
      }
      if (url.includes('/changes')) {
        return json({
          changes: [
            {
              seq: 4,
              kind: 'asset',
              objectId: 'asset-1',
              docId: document.id,
              revision: 1,
              changedAt: 10,
              deleted: true,
              deviceLabel: 'Laptop',
            },
          ],
          cursor: 4,
          serverTime: Date.now(),
        })
      }
      // What the server answers for a revision with no body.
      return new Response('Object revision has no body', { status: 404 })
    })
    vi.stubGlobal('fetch', fetch_)

    await new VaultSyncEngine().sync()

    expect(await getAsset('asset-1')).toBeUndefined()
    expect((await getVaultConfig())?.cursor).toBe(4)
    // The tombstone is handled locally; no body is ever requested for it.
    expect(
      fetch_.mock.calls.some(([input]) => String(input).includes('/objects/asset/')),
    ).toBe(false)
  })

  it('retires an unknown delete no-op without fetching revision zero', async () => {
    const config = makeVaultConfig()
    await putVaultConfig(config)
    const db = await getDB()
    await db.put(
      'syncOutbox',
      dirtyRecord('document', 'ghost-doc', 'ghost-doc', 'delete', 10),
    )

    const fetch_ = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/v1/time')) return json({ serverTime: Date.now() })
      if (init?.method === 'PUT') {
        return json({
          revision: 0,
          headRevision: 0,
          winner: 'existing',
          conflictRevision: null,
          seq: 0,
          noOp: true,
        })
      }
      if (url.includes('/changes')) {
        return json({ changes: [], cursor: 0, serverTime: Date.now() })
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch_)

    await new VaultSyncEngine().sync()

    expect(await db.get('syncOutbox', 'document:ghost-doc')).toBeUndefined()
    expect(await db.get('syncObjects', 'document:ghost-doc')).toBeUndefined()
    expect(
      fetch_.mock.calls.some(
        ([input, init]) =>
          !init?.method && String(input).includes('/objects/document/ghost-doc'),
      ),
    ).toBe(false)
  })

  it('re-reads the outbox after the remote-batch flush barrier', async () => {
    const config = makeVaultConfig()
    await putVaultConfig(config)
    const db = await getDB()
    const events: string[] = []

    const fetch_ = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/v1/time')) return json({ serverTime: Date.now() })
      if (url.includes('/changes')) {
        return json({
          changes: [
            {
              seq: 3,
              kind: 'document',
              objectId: 'doc-live',
              docId: 'doc-live',
              revision: 1,
              changedAt: 10,
              deleted: false,
              deviceLabel: 'Laptop',
            },
          ],
          cursor: 3,
          serverTime: Date.now(),
        })
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch_)

    await new VaultSyncEngine({
      onBeforeRemoteBatch: async () => {
        events.push('before')
        await db.put(
          'syncOutbox',
          dirtyRecord('document', 'doc-live', 'doc-live', 'put', 20),
        )
      },
      onRemoteChange: () => {
        events.push('changed')
      },
      onAfterRemoteBatch: () => {
        events.push('after')
      },
    }).sync()

    expect(events).toEqual(['before', 'after'])
    expect(await db.get('syncOutbox', 'document:doc-live')).toBeTruthy()
    expect((await getVaultConfig())?.cursor).toBe(3)
    expect(
      fetch_.mock.calls.some(([input]) =>
        String(input).includes('/objects/document/doc-live'),
      ),
    ).toBe(false)
  })

  it('caches a newly reported conflict even when the head revision is unchanged', async () => {
    const config = makeVaultConfig()
    await putVaultConfig(config)
    const db = await getDB()
    const document = makeDocument({ id: 'doc-compacted' })
    const conflict: SyncedDocumentPackage = {
      schemaVersion: 1,
      document,
      threads: [],
      comments: [],
      snapshots: [],
      assetIds: [],
      changedAt: 5,
      deviceLabel: 'Other device',
    }
    const ciphertext = await encryptJson(
      conflict,
      new Uint8Array(config.masterKey),
      config.vaultId,
      'document',
      document.id,
    )
    await db.put('syncObjects', {
      id: `document:${document.id}`,
      kind: 'document',
      objectId: document.id,
      revision: 2,
      changedAt: 10,
      deleted: false,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/v1/time')) return json({ serverTime: Date.now() })
        if (url.includes('/changes')) {
          return json({
            changes: [
              {
                seq: 9,
                kind: 'document',
                objectId: document.id,
                docId: document.id,
                revision: 2,
                changedAt: 10,
                deleted: false,
                conflictRevision: 1,
                deviceLabel: 'Laptop',
              },
            ],
            cursor: 9,
            serverTime: Date.now(),
          })
        }
        if (url.includes('revision=1')) return octet(ciphertext)
        throw new Error(`unexpected request: ${url}`)
      }),
    )

    await new VaultSyncEngine().sync()

    expect(await db.get('syncConflicts', `${document.id}:1`)).toBeTruthy()
    expect((await getVaultConfig())?.cursor).toBe(9)
  })

  it('rejects a document tombstone whose metadata names another document', async () => {
    const config = makeVaultConfig()
    await putVaultConfig(config)
    const db = await getDB()
    const document = makeDocument({ id: 'doc-kept' })
    await putDocument(document)
    await db.clear('syncOutbox')

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/v1/time')) return json({ serverTime: Date.now() })
        return json({
          changes: [
            {
              seq: 1,
              kind: 'document',
              objectId: 'outer-doc',
              docId: document.id,
              revision: 1,
              changedAt: 10,
              deleted: true,
              deviceLabel: 'Rogue',
            },
          ],
          cursor: 1,
          serverTime: Date.now(),
        })
      }),
    )

    await new VaultSyncEngine().sync()

    expect(await db.get('documents', document.id)).toBeTruthy()
    expect((await getVaultConfig())?.cursor).toBe(1)
  })
})
