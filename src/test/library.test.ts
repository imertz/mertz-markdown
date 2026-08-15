import { describe, expect, it } from 'vitest'
import {
  collectProjects,
  collectTags,
  filterDocuments,
  groupByProject,
} from '../lib/library'
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
