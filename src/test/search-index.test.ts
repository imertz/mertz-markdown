import { beforeEach, describe, expect, it } from 'vitest'
import { putDocument, softDeleteDocument } from '../db/documents'
import { createThread, putComment } from '../db/threads'
import {
  dropDocument,
  ensureIndex,
  invalidateIndex,
  reindexDocument,
  reindexDocumentById,
  resetIndex,
  searchPassages,
} from '../search/store'
import { applyDocumentPackage, applyRemoteDelete } from '../sync/package'
import type { DocumentRecord } from '../types'
import { makeComment, makeDocument, makeThread, resetDatabase } from './dbHarness'

/**
 * The index against a real (fake-indexeddb) database.
 *
 * These exercise the invariant the store is built on: the index is derived from
 * IndexedDB, so anything written there has to become findable, and anything
 * removed has to stop being findable.
 */

beforeEach(async () => {
  await resetDatabase()
  resetIndex()
})

const paragraphs = (...lines: string[]) => ({
  type: 'doc',
  content: lines.map(text => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })),
})

const seed = async (overrides: Partial<DocumentRecord> = {}) => {
  const record = makeDocument({
    title: 'Table notes',
    doc: paragraphs('GFM tables store alignment in the delimiter row.'),
    ...overrides,
  })
  await putDocument(record)
  return record
}

/** Every passage id a query returns, flattened out of its groups. */
const idsFor = async (term: string, options = {}) => {
  const results = await searchPassages(term, options)
  return results.groups.flatMap(group => group.hits.map(hit => hit.passage.id))
}

describe('search index', () => {
  it('finds text in a document body', async () => {
    const record = await seed()
    await ensureIndex()

    const results = await searchPassages('alignment')
    expect(results.groups).toHaveLength(1)
    expect(results.groups[0].docId).toBe(record.id)
    expect(results.groups[0].title).toBe('Table notes')
  })

  it('finds a document by its title without flooding on it', async () => {
    // Every passage would match "notes" if the title were denormalised onto
    // them; exactly one title record means exactly one hit.
    await seed({
      doc: paragraphs('One paragraph.', 'Another paragraph.', 'A third.'),
    })
    await ensureIndex()

    const hits = await idsFor('Table notes')
    expect(hits.filter(id => id.endsWith('#title'))).toHaveLength(1)
    expect(hits).toHaveLength(1)
  })

  it('hides trashed documents by default and reveals them on request', async () => {
    const record = await seed()
    await ensureIndex()

    const deleted = await softDeleteDocument(record.id)
    await reindexDocument(deleted!)

    expect((await searchPassages('alignment')).groups).toHaveLength(0)

    const withTrash = await searchPassages('alignment', { includeTrashed: true })
    expect(withTrash.groups).toHaveLength(1)
    expect(withTrash.groups[0].trashed).toBe(true)
  })

  it('replaces a document wholesale, so removed text stops matching', async () => {
    const record = await seed()
    await ensureIndex()
    expect((await searchPassages('alignment')).total).toBeGreaterThan(0)

    const rewritten: DocumentRecord = {
      ...record,
      doc: paragraphs('Completely different prose about penguins.'),
    }
    await putDocument(rewritten)
    await reindexDocument(rewritten)

    expect((await searchPassages('alignment')).total).toBe(0)
    expect((await searchPassages('penguins')).total).toBe(1)
  })

  it('forgets a document that was permanently deleted', async () => {
    const record = await seed()
    await ensureIndex()

    await dropDocument(record.id)
    expect((await searchPassages('alignment')).total).toBe(0)
  })

  it('indexes comment bodies and separates them by source', async () => {
    const record = await seed()
    const thread = makeThread(record.id)
    await createThread(thread, makeComment(thread.id, record.id, { body: 'Needs a citation here' }))
    await ensureIndex()

    const all = await searchPassages('citation')
    expect(all.total).toBe(1)
    expect(all.groups[0].hits[0].passage.kind).toBe('comment')
    expect(all.groups[0].hits[0].passage.threadId).toBe(thread.id)

    // The chips filter on the same field the facets count.
    expect((await searchPassages('citation', { source: 'document' })).total).toBe(0)
    expect((await searchPassages('citation', { source: 'comment' })).total).toBe(1)
  })

  it('picks up a comment written after the index was built', async () => {
    const record = await seed()
    const thread = makeThread(record.id)
    await createThread(thread, makeComment(thread.id, record.id, { body: 'First remark' }))
    await ensureIndex()

    await putComment(makeComment(thread.id, record.id, { body: 'A later afterthought' }))
    await reindexDocumentById(record.id)

    expect((await searchPassages('afterthought')).total).toBe(1)
  })

  it('counts facets over the whole match set', async () => {
    const record = await seed({ doc: paragraphs('shared word here', 'shared word again') })
    const thread = makeThread(record.id)
    await createThread(thread, makeComment(thread.id, record.id, { body: 'shared word too' }))
    await ensureIndex()

    const results = await searchPassages('shared')
    expect(results.facets.documents).toBe(2)
    expect(results.facets.comments).toBe(1)
  })

  it('orders documents by their best passage and keeps passages ranked', async () => {
    await putDocument(
      makeDocument({
        title: 'Passing mention',
        doc: paragraphs('A single mention of widgets in passing.'),
      }),
    )
    await putDocument(
      makeDocument({
        title: 'All about widgets',
        doc: paragraphs('Widgets, widgets, widgets.', 'More widgets discussion.'),
      }),
    )
    await ensureIndex()

    const results = await searchPassages('widgets')
    expect(results.groups.length).toBeGreaterThan(1)

    for (const group of results.groups) {
      const scores = group.hits.map(hit => hit.score)
      expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    }
    // Group order follows the best hit in each group.
    const best = results.groups.map(group => group.hits[0].score)
    expect([...best].sort((a, b) => b - a)).toEqual(best)
  })

  it('ignores writes until something has asked for the index', async () => {
    // reindexDocument before any build is a deliberate no-op: the record is
    // already in IndexedDB, so the eventual build will pick it up anyway.
    const record = await seed()
    await reindexDocument(record)

    expect((await searchPassages('alignment')).total).toBe(1)
  })

  it('supersedes an initial build invalidated while it is in flight', async () => {
    await seed()
    const obsolete = ensureIndex()
    invalidateIndex()
    const current = ensureIndex()

    expect(await obsolete).toBe(await current)
    expect((await searchPassages('alignment')).total).toBe(1)
  })

  it('rebuilds document and comment passages after a remote package', async () => {
    const record = await seed()
    await ensureIndex()

    const thread = makeThread(record.id)
    await applyDocumentPackage({
      schemaVersion: 1,
      document: {
        ...record,
        doc: paragraphs('The remote version discusses puffins.'),
        markdown: 'The remote version discusses puffins.\n',
        updatedAt: record.updatedAt + 1,
      },
      threads: [thread],
      comments: [
        makeComment(thread.id, record.id, {
          body: 'Confirm the migration checklist.',
        }),
      ],
      snapshots: [],
      assetIds: [],
      changedAt: record.updatedAt + 1,
      deviceLabel: 'Remote laptop',
    })
    invalidateIndex()

    expect((await searchPassages('alignment')).total).toBe(0)
    expect((await searchPassages('puffins')).total).toBe(1)
    expect((await searchPassages('migration', { source: 'comment' })).total).toBe(1)
  })

  it('forgets a remotely deleted document after invalidation', async () => {
    const record = await seed()
    await ensureIndex()

    await applyRemoteDelete(record.id)
    invalidateIndex()

    expect((await searchPassages('alignment')).total).toBe(0)
  })

  it('matches Greek regardless of accents, end to end', async () => {
    await seed({ doc: paragraphs('Η πλατεία ήταν γεμάτη κόσμο.') })
    await ensureIndex()

    expect((await searchPassages('πλατεια')).total).toBe(1)
    expect((await searchPassages('πλατεία')).total).toBe(1)
  })

  it('requires every term of a multi-term query', async () => {
    await putDocument(
      makeDocument({ title: 'A', doc: paragraphs('the quarterly review went well') }),
    )
    await putDocument(
      makeDocument({ title: 'B', doc: paragraphs('a review of nothing in particular') }),
    )
    await ensureIndex()

    const results = await searchPassages('quarterly review')
    expect(results.total).toBe(1)
  })

  it('returns nothing for an empty query rather than everything', async () => {
    await seed()
    await ensureIndex()

    expect((await searchPassages('   ')).groups).toHaveLength(0)
  })
})
