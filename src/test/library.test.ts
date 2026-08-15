import { describe, expect, it } from 'vitest'
import {
  bucketByRecency,
  collectProjects,
  collectTags,
  filterDocuments,
  groupByProject,
  isBlankDraft,
} from '../lib/library'
import { UNTITLED } from '../lib/title'
import { makeDocument } from './dbHarness'

/**
 * Deriving the library from the documents.
 *
 * There is no project store and no tag store, so everything here is the only
 * definition of what a project or tag *is*. The ordering rules are the part
 * with teeth — they are what the menu reads directly.
 */

const notes = makeDocument({
  title: 'Notes on X',
  project: 'Research',
  tags: ['draft', 'urgent'],
})
const reading = makeDocument({
  title: 'Reading list',
  project: 'research',
  tags: ['draft'],
})
const scratch = makeDocument({ title: 'Scratch' })
const admin = makeDocument({ title: 'Invoices', project: 'Admin' })

const library = [notes, reading, scratch, admin]

describe('collectProjects', () => {
  it('folds case and keeps the first spelling seen', () => {
    expect(collectProjects(library)).toEqual([
      { name: 'Admin', count: 1 },
      { name: 'Research', count: 2 },
    ])
  })

  it('ignores unfiled documents rather than inventing a project for them', () => {
    expect(collectProjects([scratch])).toEqual([])
  })
})

describe('collectTags', () => {
  it('orders by use, then alphabetically', () => {
    // The chips are one row that will wrap or clip, so the ones worth
    // clicking have to be the ones that survive.
    expect(collectTags(library)).toEqual([
      { name: 'draft', count: 2 },
      { name: 'urgent', count: 1 },
    ])
  })
})

describe('groupByProject', () => {
  it('sorts projects alphabetically and puts the unfiled group last', () => {
    expect(groupByProject(library).map(group => group.project)).toEqual([
      'Admin',
      'Research',
      null,
    ])
  })

  it('omits the unfiled group entirely when everything is filed', () => {
    expect(groupByProject([notes, admin]).map(group => group.project)).toEqual([
      'Admin',
      'Research',
    ])
  })

  it('keeps the order documents arrived in — grouping is not a re-sort', () => {
    const [, research] = groupByProject(library)
    expect(research?.documents.map(record => record.title)).toEqual([
      'Notes on X',
      'Reading list',
    ])
  })
})

describe('bucketByRecency', () => {
  // Mid-afternoon, so "an hour ago" and "ten hours ago" fall on the same
  // calendar day and the day boundary is the only thing being tested.
  const now = new Date(2026, 7, 15, 15, 0, 0).getTime()
  const HOUR = 3_600_000
  const DAY = 86_400_000

  const at = (updatedAt: number, title: string) =>
    makeDocument({ title, updatedAt })

  it('cuts a group into dated runs, newest first', () => {
    const buckets = bucketByRecency(
      [
        at(now - HOUR, 'this afternoon'),
        at(now - 14 * HOUR, 'this morning'),
        at(now - 20 * HOUR, 'last night'),
        at(now - 3 * DAY, 'midweek'),
        at(now - 30 * DAY, 'last month'),
      ],
      now,
    )

    expect(buckets.map(bucket => bucket.label)).toEqual([
      'Today',
      'Yesterday',
      'Last 7 days',
      'Earlier',
    ])
    expect(buckets[0]?.documents.map(record => record.title)).toEqual([
      'this afternoon',
      'this morning',
    ])
  })

  it('measures calendar days, not the last 24 hours', () => {
    // 23:50 the previous evening is ten hours old and still yesterday.
    const lastNight = new Date(2026, 7, 14, 23, 50, 0).getTime()
    const [bucket] = bucketByRecency([at(lastNight, 'late edit')], now)

    expect(bucket?.key).toBe('yesterday')
  })

  it('drops the buckets nothing lands in', () => {
    // A library touched only this morning gets one heading, not four with
    // three of them saying nothing.
    const buckets = bucketByRecency([at(now - HOUR, 'a'), at(now, 'b')], now)

    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.key).toBe('today')
  })
})

describe('isBlankDraft', () => {
  it('is true for a document with no content and no name of its own', () => {
    expect(isBlankDraft(makeDocument({ title: UNTITLED }))).toBe(true)
  })

  it('is false once there is something to tell it apart by', () => {
    // An image-only document derives the placeholder title too — the markdown
    // is what says it is not blank.
    expect(
      isBlankDraft(makeDocument({ title: UNTITLED, markdown: '![](a.png)' })),
    ).toBe(false)
  })

  it('is false for a document deliberately named "Untitled document"', () => {
    expect(
      isBlankDraft(
        makeDocument({ title: UNTITLED, titleOverride: UNTITLED }),
      ),
    ).toBe(false)
  })

  it('is false for anything carrying a derived title', () => {
    expect(isBlankDraft(notes)).toBe(false)
  })
})

describe('filterDocuments', () => {
  it('requires every selected tag, not any of them', () => {
    expect(
      filterDocuments(library, { tags: ['draft', 'urgent'] }).map(r => r.title),
    ).toEqual(['Notes on X'])
  })

  it('matches tags regardless of the case the chip was spelled in', () => {
    expect(filterDocuments(library, { tags: ['DRAFT'] })).toHaveLength(2)
  })

  it('matches the title as a subsequence, like the palette does', () => {
    expect(filterDocuments(library, { query: 'nox' }).map(r => r.title)).toEqual([
      'Notes on X',
    ])
  })

  it('combines the query with the chips', () => {
    expect(
      filterDocuments(library, { query: 'read', tags: ['draft'] }).map(r => r.title),
    ).toEqual(['Reading list'])
  })

  it('returns the list untouched when nothing is being filtered', () => {
    expect(filterDocuments(library)).toHaveLength(library.length)
  })
})
