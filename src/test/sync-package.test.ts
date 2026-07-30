import { beforeEach, describe, expect, it } from 'vitest'
import { putAssets } from '../db/assets'
import { getDB } from '../db/client'
import { putDocument } from '../db/documents'
import { addSnapshot } from '../db/snapshots'
import { createThread, loadThreadsForDoc } from '../db/threads'
import { applyDocumentPackage, buildDocumentPackage } from '../sync/package'
import { restoreConflict } from '../sync/local'
import {
  makeAsset,
  makeComment,
  makeDocument,
  makeThread,
  resetDatabase,
} from './dbHarness'

beforeEach(resetDatabase)

describe('sync document packages', () => {
  it('collects the canonical document and every sidecar', async () => {
    const document = makeDocument({ markdown: '# Synced\n' })
    const thread = makeThread(document.id)
    const comment = makeComment(thread.id, document.id)
    const asset = makeAsset(document.id)
    await putDocument(document)
    await createThread(thread, comment)
    await putAssets([asset])
    await addSnapshot({
      id: 'snapshot-1',
      docId: document.id,
      doc: document.doc,
      markdown: document.markdown,
      title: document.title,
      createdAt: 10,
      cause: 'manual',
    })

    const package_ = await buildDocumentPackage(document.id, 20, 'Laptop')
    expect(package_?.document).toEqual(document)
    expect(package_?.threads).toEqual([thread])
    expect(package_?.comments).toEqual([comment])
    expect(package_?.snapshots.map(record => record.id)).toEqual(['snapshot-1'])
    expect(package_?.assetIds).toEqual([asset.id])
  })

  it('replaces sidecars without creating an upload echo', async () => {
    const document = makeDocument()
    const oldThread = makeThread(document.id)
    await putDocument(document)
    await createThread(oldThread, makeComment(oldThread.id, document.id))
    const db = await getDB()
    await db.clear('syncOutbox')

    const replacement = makeThread(document.id)
    await applyDocumentPackage({
      schemaVersion: 1,
      document: { ...document, markdown: 'remote\n', updatedAt: 50 },
      threads: [replacement],
      comments: [makeComment(replacement.id, document.id)],
      snapshots: [],
      assetIds: [],
      changedAt: 50,
      deviceLabel: 'Desktop',
    })

    expect((await loadThreadsForDoc(document.id)).map(record => record.id)).toEqual([
      replacement.id,
    ])
    expect(await db.count('syncOutbox')).toBe(0)
  })

  it('queues document and asset mutations for a future vault', async () => {
    const document = makeDocument()
    const asset = makeAsset(document.id)
    await putDocument(document)
    await putAssets([asset])

    const db = await getDB()
    expect(await db.get('syncOutbox', `document:${document.id}`)).toMatchObject({
      kind: 'document',
      docId: document.id,
    })
    expect(await db.get('syncOutbox', `asset:${asset.id}`)).toMatchObject({
      kind: 'asset',
      docId: document.id,
    })
  })

  it('keeps the current snapshot when a complete conflict package is restored', async () => {
    const document = makeDocument({ markdown: 'current\n' })
    await putDocument(document)
    await addSnapshot({
      id: 'before-conflict',
      docId: document.id,
      doc: document.doc,
      markdown: document.markdown,
      title: document.title,
      createdAt: 40,
      cause: 'restore',
    })

    await restoreConflict({
      id: `${document.id}:2`,
      docId: document.id,
      revision: 2,
      changedAt: 20,
      deviceLabel: 'Offline laptop',
      createdAt: 50,
      package: {
        schemaVersion: 1,
        document: { ...document, markdown: 'conflict\n', updatedAt: 20 },
        threads: [],
        comments: [],
        snapshots: [],
        assetIds: [],
        changedAt: 20,
        deviceLabel: 'Offline laptop',
      },
    })

    const db = await getDB()
    expect((await db.getAllFromIndex('snapshots', 'by-docId', document.id)).map(row => row.id)).toContain(
      'before-conflict',
    )
    expect((await db.get('documents', document.id))?.markdown).toBe('conflict\n')
  })
})
