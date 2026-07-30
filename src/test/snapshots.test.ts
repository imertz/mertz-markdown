import type { JSONContent } from '@tiptap/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../db/client'
import { getDocument, putDocument } from '../db/documents'
import { DB_NAME } from '../db/schema'
import {
  addSnapshot,
  latestSnapshotAt,
  listSnapshots,
  pruneSnapshots,
} from '../db/snapshots'
import { createId } from '../lib/id'
import { shouldSnapshot, SNAPSHOT_INTERVAL_MS } from '../lib/snapshotPolicy'
import type { SnapshotCause } from '../types'
import { makeDocument, resetDatabase } from './dbHarness'

beforeEach(resetDatabase)

const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

const seed = (docId: string, createdAt: number, cause: SnapshotCause = 'interval') =>
  addSnapshot({
    id: createId(),
    docId,
    doc,
    markdown: `at ${createdAt}`,
    title: 'Notes',
    createdAt,
    cause,
  })

describe('snapshot store', () => {
  it('lists one document’s snapshots newest first', async () => {
    await seed('doc-a', 1000)
    await seed('doc-a', 3000)
    await seed('doc-a', 2000)
    await seed('doc-b', 9000)

    const listed = await listSnapshots('doc-a')
    expect(listed.map(record => record.createdAt)).toEqual([3000, 2000, 1000])
  })

  it('returns nothing for a document that has none', async () => {
    await seed('doc-a', 1000)
    expect(await listSnapshots('doc-b')).toEqual([])
  })

  it('reports the newest timestamp without loading the records', async () => {
    expect(await latestSnapshotAt('doc-a')).toBeNull()

    await seed('doc-a', 1000)
    await seed('doc-a', 5000)
    await seed('doc-b', 9999)

    expect(await latestSnapshotAt('doc-a')).toBe(5000)
  })

  it('prunes the oldest past the limit, and only for that document', async () => {
    for (const at of [1000, 2000, 3000, 4000, 5000]) await seed('doc-a', at)
    await seed('doc-b', 1000)

    expect(await pruneSnapshots('doc-a', 2)).toBe(3)

    expect((await listSnapshots('doc-a')).map(r => r.createdAt)).toEqual([
      5000, 4000,
    ])
    expect(await listSnapshots('doc-b')).toHaveLength(1)
  })

  it('prunes nothing when the document is under the limit', async () => {
    await seed('doc-a', 1000)
    expect(await pruneSnapshots('doc-a', 50)).toBe(0)
  })
})

describe('snapshot policy', () => {
  it('always snapshots a document that has none', () => {
    expect(shouldSnapshot(null, 0)).toBe(true)
  })

  it('waits out the interval before taking another', () => {
    const now = 10 * SNAPSHOT_INTERVAL_MS
    expect(shouldSnapshot(now - 1000, now)).toBe(false)
    expect(shouldSnapshot(now - SNAPSHOT_INTERVAL_MS, now)).toBe(true)
  })
})

describe('migration from version 1', () => {
  it('adds the snapshots store and keeps the data that was there', async () => {
    const legacy = makeDocument({ title: 'Written before the upgrade' })

    // Build a v1 database by hand, exactly as the original upgrade() did.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        const documents = db.createObjectStore('documents', { keyPath: 'id' })
        documents.createIndex('by-updatedAt', 'updatedAt')
        const threads = db.createObjectStore('threads', { keyPath: 'id' })
        threads.createIndex('by-docId', 'docId')
        threads.createIndex('by-doc-status', ['docId', 'status'])
        const comments = db.createObjectStore('comments', { keyPath: 'id' })
        comments.createIndex('by-threadId', 'threadId')
        comments.createIndex('by-docId', 'docId')
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('documents', 'readwrite')
        tx.objectStore('documents').put(legacy)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })

    // Opening through the app's client runs every fall-through migration.
    const db = await getDB()
    expect(db.version).toBe(4)
    expect([...db.objectStoreNames]).toContain('snapshots')
    expect([...db.objectStoreNames]).toContain('assets')

    // The upgrade must add, never rebuild: an existing document survives it.
    expect((await getDocument(legacy.id))?.title).toBe(
      'Written before the upgrade',
    )

    // …and the new store is usable straight away.
    await putDocument(legacy)
    await seed(legacy.id, 1234)
    expect(await listSnapshots(legacy.id)).toHaveLength(1)
  })
})
