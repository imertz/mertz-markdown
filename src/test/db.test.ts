import { beforeEach, describe, expect, it } from 'vitest'
import { closeDB, getDB } from '../db/client'
import { DB_NAME } from '../db/schema'
import { getAsset, getDocumentAsset, putAssets, putRemoteAsset } from '../db/assets'
import {
  deleteDocumentCascade,
  getDocument,
  listDocuments,
  putDocument,
} from '../db/documents'
import {
  createThread,
  deleteThreadCascade,
  loadThreadsForDoc,
  putThreads,
} from '../db/threads'
import {
  makeComment,
  makeAsset,
  makeDocument,
  makeThread,
  resetDatabase,
} from './dbHarness'

beforeEach(resetDatabase)

describe('schema creation', () => {
  it('creates every store with its indexes', async () => {
    const db = await getDB()

    expect([...db.objectStoreNames].sort()).toEqual([
      'assets',
      'comments',
      'documents',
      'snapshots',
      'syncConflicts',
      'syncObjects',
      'syncOutbox',
      'threads',
      'vaultConfig',
    ])

    const tx = db.transaction(
      ['documents', 'threads', 'comments', 'snapshots', 'assets'],
      'readonly',
    )
    expect([...tx.objectStore('documents').indexNames]).toEqual(['by-updatedAt'])
    expect([...tx.objectStore('threads').indexNames].sort()).toEqual([
      'by-doc-status',
      'by-docId',
    ])
    expect([...tx.objectStore('comments').indexNames].sort()).toEqual([
      'by-docId',
      'by-threadId',
    ])
    expect([...tx.objectStore('snapshots').indexNames].sort()).toEqual([
      'by-doc-createdAt',
      'by-docId',
    ])
    expect([...tx.objectStore('assets').indexNames]).toEqual(['by-docId'])
    await tx.done

    const syncTx = db.transaction(['syncOutbox', 'syncConflicts'], 'readonly')
    expect([...syncTx.objectStore('syncOutbox').indexNames]).toEqual([
      'by-nextAttemptAt',
    ])
    expect([...syncTx.objectStore('syncConflicts').indexNames]).toEqual([
      'by-doc-createdAt',
    ])
    await syncTx.done
  })

  it('upgrades a legacy v2 database without touching its existing stores', async () => {
    await closeDB()
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('documents', { keyPath: 'id' })
        db.createObjectStore('threads', { keyPath: 'id' })
        db.createObjectStore('comments', { keyPath: 'id' })
        db.createObjectStore('snapshots', { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    legacy.close()

    const upgraded = await getDB()
    expect([...upgraded.objectStoreNames].sort()).toEqual([
      'assets',
      'comments',
      'documents',
      'snapshots',
      'syncConflicts',
      'syncObjects',
      'syncOutbox',
      'threads',
      'vaultConfig',
    ])
  })
})

describe('documents', () => {
  it('round-trips a document whose canonical doc carries comment marks', async () => {
    // The whole design rests on PM JSON surviving structured clone with its
    // marks intact — that is what makes anchors durable across a reload.
    const doc = makeDocument({
      title: 'With comments',
      markdown: 'The quick brown fox.\n',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'The ' },
              {
                type: 'text',
                text: 'quick brown',
                marks: [
                  {
                    type: 'comment',
                    attrs: { threadId: 'thread-abc', resolved: false },
                  },
                ],
              },
              { type: 'text', text: ' fox.' },
            ],
          },
        ],
      },
    })

    await putDocument(doc)
    const loaded = await getDocument(doc.id)

    expect(loaded).toEqual(doc)
    expect(loaded?.doc.content?.[0]?.content?.[1]?.marks?.[0]?.attrs).toEqual({
      threadId: 'thread-abc',
      resolved: false,
    })
  })

  it('lists live documents newest-updated first and hides tombstones', async () => {
    const old = makeDocument({ title: 'Older', updatedAt: 1_000 })
    const fresh = makeDocument({ title: 'Newer', updatedAt: 2_000 })
    const gone = makeDocument({
      title: 'Deleted',
      updatedAt: 3_000,
      deletedAt: 3_500,
    })

    await Promise.all([putDocument(old), putDocument(fresh), putDocument(gone)])

    expect((await listDocuments()).map(d => d.title)).toEqual([
      'Newer',
      'Older',
    ])
  })

  it('cascade-deletes leave zero orphaned threads or comments', async () => {
    const doc = makeDocument()
    const other = makeDocument()
    await Promise.all([putDocument(doc), putDocument(other)])

    const threadA = makeThread(doc.id)
    const threadB = makeThread(doc.id)
    const survivor = makeThread(other.id)
    const doomedAsset = makeAsset(doc.id)
    const survivingAsset = makeAsset(other.id)

    await Promise.all([
      createThread(threadA, makeComment(threadA.id, doc.id)),
      createThread(threadB, makeComment(threadB.id, doc.id)),
      createThread(survivor, makeComment(survivor.id, other.id)),
      putAssets([doomedAsset, survivingAsset]),
    ])

    await deleteDocumentCascade(doc.id)

    const db = await getDB()
    expect(await getDocument(doc.id)).toBeUndefined()
    expect(await db.count('threads')).toBe(1)
    expect(await db.count('comments')).toBe(1)
    expect(await db.get('assets', doomedAsset.id)).toBeUndefined()
    expect((await db.get('assets', survivingAsset.id))?.storageName).toBe(
      survivingAsset.storageName,
    )
    // The untouched document keeps everything it owns.
    expect((await loadThreadsForDoc(other.id)).map(t => t.id)).toEqual([
      survivor.id,
    ])
  })

  it('stores image blobs separately and scopes lookup to their document', async () => {
    const doc = makeDocument()
    const other = makeDocument()
    const asset = makeAsset(doc.id)
    await Promise.all([putDocument(doc), putDocument(other), putAssets([asset])])

    const loaded = await getDocumentAsset(doc.id, asset.id)
    expect(loaded?.storageName).toBe(asset.storageName)
    expect(await loaded?.blob.text()).toBe('image bytes')
    expect(await getDocumentAsset(other.id, asset.id)).toBeUndefined()
  })

  it('persists image bytes instead of Blob/File structured clones', async () => {
    const doc = makeDocument()
    const asset = makeAsset(doc.id, {
      blob: new File(['safari image'], 'safari.png', { type: 'image/png' }),
      size: 12,
    })
    await putAssets([asset])

    const db = await getDB()
    const stored = await db.get('assets', asset.id)
    expect(stored?.bytes).toBeInstanceOf(ArrayBuffer)
    expect(stored?.blob).toBeUndefined()
    expect(await (await getAsset(asset.id))?.blob.text()).toBe('safari image')
  })

  it('stores downloaded vault images as bytes without creating an upload echo', async () => {
    const asset = makeAsset('remote-doc')
    await putRemoteAsset(asset)

    const db = await getDB()
    expect((await db.get('assets', asset.id))?.bytes).toBeInstanceOf(ArrayBuffer)
    expect(await db.get('syncOutbox', `asset:${asset.id}`)).toBeUndefined()
    expect(await (await getAsset(asset.id))?.blob.text()).toBe('image bytes')
  })
})

describe('threads', () => {
  it('joins comments onto their thread, oldest comment first', async () => {
    const doc = makeDocument()
    await putDocument(doc)

    const thread = makeThread(doc.id)
    const first = makeComment(thread.id, doc.id, {
      body: 'first',
      createdAt: 100,
    })
    await createThread(thread, first)

    const db = await getDB()
    await db.put(
      'comments',
      makeComment(thread.id, doc.id, { body: 'third', createdAt: 300 }),
    )
    await db.put(
      'comments',
      makeComment(thread.id, doc.id, { body: 'second', createdAt: 200 }),
    )

    const [loaded] = await loadThreadsForDoc(doc.id)
    expect(loaded?.comments.map(c => c.body)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('returns a thread with no comments rather than dropping it', async () => {
    const doc = makeDocument()
    await putDocument(doc)
    await putThreads([makeThread(doc.id)])

    const loaded = await loadThreadsForDoc(doc.id)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.comments).toEqual([])
  })

  it('writes a batch of status changes in one transaction', async () => {
    const doc = makeDocument()
    await putDocument(doc)

    const threads = [makeThread(doc.id), makeThread(doc.id)]
    await putThreads(threads)

    await putThreads(
      threads.map(t => ({ ...t, status: 'orphaned' as const, orphanedAt: 42 })),
    )

    const loaded = await loadThreadsForDoc(doc.id)
    expect(loaded.map(t => t.status)).toEqual(['orphaned', 'orphaned'])
    expect(loaded.every(t => t.orphanedAt === 42)).toBe(true)
  })

  it('cascade-deletes a single thread without touching its siblings', async () => {
    const doc = makeDocument()
    await putDocument(doc)

    const doomed = makeThread(doc.id)
    const keeper = makeThread(doc.id)
    await createThread(doomed, makeComment(doomed.id, doc.id))
    await createThread(keeper, makeComment(keeper.id, doc.id))

    const db = await getDB()
    await db.put('comments', makeComment(doomed.id, doc.id, { body: 'reply' }))

    await deleteThreadCascade(doomed.id)

    const remaining = await loadThreadsForDoc(doc.id)
    expect(remaining.map(t => t.id)).toEqual([keeper.id])
    expect(await db.count('comments')).toBe(1)
  })

  it('filters threads by document via the by-doc-status index', async () => {
    const a = makeDocument()
    const b = makeDocument()
    await Promise.all([putDocument(a), putDocument(b)])

    await putThreads([
      makeThread(a.id, { status: 'open' }),
      makeThread(a.id, { status: 'resolved' }),
      makeThread(b.id, { status: 'open' }),
    ])

    const db = await getDB()
    const openInA = await db.getAllFromIndex('threads', 'by-doc-status', [
      a.id,
      'open',
    ])
    expect(openInA).toHaveLength(1)
    expect(openInA[0]?.docId).toBe(a.id)
  })
})
