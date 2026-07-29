import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../db/client'
import {
  TRASH_TTL_MS,
  deleteDocumentCascade,
  listDocuments,
  listTrashedDocuments,
  purgeExpiredTrash,
  putDocument,
  restoreDocument,
  softDeleteDocument,
} from '../db/documents'
import { createThread } from '../db/threads'
import { addSnapshot } from '../db/snapshots'
import { loadThreadsForDoc } from '../db/threads'
import { createId } from '../lib/id'
import {
  makeComment,
  makeDocument,
  makeThread,
  resetDatabase,
} from './dbHarness'

beforeEach(resetDatabase)

const seedDocument = async () => {
  const document_ = makeDocument({ title: 'Notes' })
  await putDocument(document_)

  const thread = makeThread(document_.id)
  await createThread(thread, makeComment(thread.id, document_.id))
  await addSnapshot({
    id: createId(),
    docId: document_.id,
    doc: document_.doc,
    markdown: '# Notes',
    title: 'Notes',
    createdAt: Date.now(),
    cause: 'interval',
  })

  return document_
}

describe('soft delete', () => {
  it('hides the document from the live list and shows it in the trash', async () => {
    const document_ = await seedDocument()

    await softDeleteDocument(document_.id)

    expect(await listDocuments()).toEqual([])
    expect((await listTrashedDocuments()).map(d => d.id)).toEqual([
      document_.id,
    ])
  })

  it('leaves threads, comments and snapshots intact', async () => {
    const document_ = await seedDocument()

    await softDeleteDocument(document_.id)

    // This is what makes restore bring the document back whole rather than as
    // a stripped copy of itself.
    const threads = await loadThreadsForDoc(document_.id)
    expect(threads).toHaveLength(1)
    expect(threads[0].comments).toHaveLength(1)

    const db = await getDB()
    expect(await db.getAllFromIndex('snapshots', 'by-docId', document_.id))
      .toHaveLength(1)
  })

  it('does not touch updatedAt', async () => {
    // Deleting is not editing: bumping it would silently reorder the document
    // to the top of the list when it came back.
    const document_ = await seedDocument()

    const trashed = await softDeleteDocument(document_.id)
    expect(trashed?.updatedAt).toBe(document_.updatedAt)
  })

  it('is a no-op for an id that is not there', async () => {
    expect(await softDeleteDocument('missing')).toBeUndefined()
  })
})

describe('restore', () => {
  it('puts the document back with everything still attached', async () => {
    const document_ = await seedDocument()
    await softDeleteDocument(document_.id)

    await restoreDocument(document_.id)

    expect((await listDocuments()).map(d => d.id)).toEqual([document_.id])
    expect(await listTrashedDocuments()).toEqual([])
    expect(await loadThreadsForDoc(document_.id)).toHaveLength(1)
  })
})

describe('purge', () => {
  it('destroys only what has been in the trash past the TTL', async () => {
    const stale = await seedDocument()
    const fresh = await seedDocument()

    const now = Date.now()
    await softDeleteDocument(stale.id, now - TRASH_TTL_MS - 1)
    await softDeleteDocument(fresh.id, now - 1000)

    expect(await purgeExpiredTrash(now)).toBe(1)
    expect((await listTrashedDocuments()).map(d => d.id)).toEqual([fresh.id])
  })

  it('takes the threads, comments and snapshots with it', async () => {
    const document_ = await seedDocument()
    await softDeleteDocument(document_.id, Date.now() - TRASH_TTL_MS - 1)

    await purgeExpiredTrash()

    const db = await getDB()
    expect(await loadThreadsForDoc(document_.id)).toEqual([])
    expect(await db.getAllFromIndex('comments', 'by-docId', document_.id))
      .toEqual([])
    expect(await db.getAllFromIndex('snapshots', 'by-docId', document_.id))
      .toEqual([])
  })

  it('leaves live documents alone however old they are', async () => {
    const document_ = await seedDocument()

    expect(await purgeExpiredTrash(Date.now() + TRASH_TTL_MS * 10)).toBe(0)
    expect((await listDocuments()).map(d => d.id)).toEqual([document_.id])
  })
})

describe('permanent delete', () => {
  it('cascades to snapshots as well as threads and comments', async () => {
    const document_ = await seedDocument()

    await deleteDocumentCascade(document_.id)

    const db = await getDB()
    // A snapshot left behind would be an orphaned copy of a whole document —
    // invisible, unreachable, and still occupying the storage quota.
    expect(await db.getAll('snapshots')).toEqual([])
    expect(await db.getAll('threads')).toEqual([])
    expect(await db.getAll('comments')).toEqual([])
    expect(await db.getAll('documents')).toEqual([])
  })
})
