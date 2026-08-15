import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../db/client'
import {
  getDocument,
  putDocument,
  renameProject,
  renameTag,
  setDocumentProject,
  setDocumentTags,
} from '../db/documents'
import { makeDocument, resetDatabase } from './dbHarness'

/**
 * Filing documents into projects and tagging them.
 *
 * Two invariants carry this feature and both are asserted here: `updatedAt`
 * never moves, and every rewritten document queues its own sync entry. The
 * second is what stands in for a project object — there is nothing else to
 * upload, because the project list is derived from the documents.
 */

beforeEach(resetDatabase)

const outboxIds = async (): Promise<string[]> => {
  const rows = await (await getDB()).getAll('syncOutbox')
  return rows.map(row => row.objectId).sort()
}

const clearOutbox = async (): Promise<void> => {
  await (await getDB()).clear('syncOutbox')
}

describe('filing one document', () => {
  it('files and unfiles without touching updatedAt', async () => {
    // The list is ordered by updatedAt, and re-filing a document from inside
    // that list must not make the row jump out from under the pointer.
    const record = makeDocument({ title: 'Notes', updatedAt: 1000 })
    await putDocument(record)
    await clearOutbox()

    await setDocumentProject(record.id, 'Research')
    const filed = await getDocument(record.id)
    expect(filed?.project).toBe('Research')
    expect(filed?.updatedAt).toBe(1000)

    await setDocumentProject(record.id, null)
    expect((await getDocument(record.id))?.project).toBeNull()
  })

  it('queues the document for sync, which is all a project needs', async () => {
    const record = makeDocument()
    await putDocument(record)
    await clearOutbox()

    await setDocumentProject(record.id, 'Research')
    expect(await outboxIds()).toEqual([record.id])
  })

  it('normalises tags on the way in', async () => {
    const record = makeDocument()
    await putDocument(record)

    await setDocumentTags(record.id, ['#urgent', 'draft', 'DRAFT', '  '])
    expect((await getDocument(record.id))?.tags).toEqual(['draft', 'urgent'])
  })

  it('leaves a missing document alone rather than creating one', async () => {
    expect(await setDocumentProject('nope', 'Research')).toBeUndefined()
    expect(await setDocumentTags('nope', ['draft'])).toBeUndefined()
  })
})

describe('renameProject', () => {
  it('rewrites every document under the name, matching case-insensitively', async () => {
    const notes = makeDocument({ project: 'Research', updatedAt: 500 })
    const reading = makeDocument({ project: 'research' })
    const other = makeDocument({ project: 'Admin' })
    for (const record of [notes, reading, other]) await putDocument(record)
    await clearOutbox()

    expect(await renameProject('Research', 'Client work')).toBe(2)

    expect((await getDocument(notes.id))?.project).toBe('Client work')
    expect((await getDocument(reading.id))?.project).toBe('Client work')
    expect((await getDocument(other.id))?.project).toBe('Admin')
    // Renaming is filing, not editing.
    expect((await getDocument(notes.id))?.updatedAt).toBe(500)
  })

  it('queues one outbox entry per rewritten document', async () => {
    const notes = makeDocument({ project: 'Research' })
    const reading = makeDocument({ project: 'Research' })
    for (const record of [notes, reading]) await putDocument(record)
    await clearOutbox()

    await renameProject('Research', 'Client work')
    expect(await outboxIds()).toEqual([notes.id, reading.id].sort())
  })

  it('unfiles everything when the new name is null', async () => {
    const record = makeDocument({ project: 'Research' })
    await putDocument(record)

    await renameProject('Research', null)
    expect((await getDocument(record.id))?.project).toBeNull()
  })

  it('rewrites trashed documents too, so restoring puts one back in place', async () => {
    const gone = makeDocument({ project: 'Research', deletedAt: Date.now() })
    await putDocument(gone)

    await renameProject('Research', 'Client work')
    expect((await getDocument(gone.id))?.project).toBe('Client work')
  })

  it('changes nothing, and queues nothing, for a project nobody uses', async () => {
    await putDocument(makeDocument({ project: 'Research' }))
    await clearOutbox()

    expect(await renameProject('Missing', 'Other')).toBe(0)
    expect(await outboxIds()).toEqual([])
  })
})

describe('renameTag', () => {
  it('renames the tag wherever it appears and leaves the rest alone', async () => {
    const one = makeDocument({ tags: ['draft', 'urgent'], updatedAt: 700 })
    const two = makeDocument({ tags: ['idea'] })
    for (const record of [one, two]) await putDocument(record)

    expect(await renameTag('draft', 'wip')).toBe(1)
    expect((await getDocument(one.id))?.tags).toEqual(['urgent', 'wip'])
    expect((await getDocument(two.id))?.tags).toEqual(['idea'])
    expect((await getDocument(one.id))?.updatedAt).toBe(700)
  })

  it('merges rather than duplicating when the target already exists', async () => {
    const record = makeDocument({ tags: ['draft', 'wip'] })
    await putDocument(record)

    await renameTag('draft', 'WIP')
    // First spelling wins on the dedupe, so the existing chip is unchanged.
    expect((await getDocument(record.id))?.tags).toEqual(['wip'])
  })

  it('removes the tag everywhere when the new name is null', async () => {
    const record = makeDocument({ tags: ['draft', 'urgent'] })
    await putDocument(record)

    expect(await renameTag('draft', null)).toBe(1)
    expect((await getDocument(record.id))?.tags).toEqual(['urgent'])
  })

  it('queues one outbox entry per rewritten document', async () => {
    const one = makeDocument({ tags: ['draft'] })
    const two = makeDocument({ tags: ['draft'] })
    const three = makeDocument({ tags: ['idea'] })
    for (const record of [one, two, three]) await putDocument(record)
    await clearOutbox()

    await renameTag('draft', 'wip')
    expect(await outboxIds()).toEqual([one.id, two.id].sort())
  })
})
