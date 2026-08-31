import { describe, expect, it } from 'vitest'
import { parseSearchQuery } from '../search/query'

describe('parseSearchQuery', () => {
  it('returns clean term when no directives are present', () => {
    expect(parseSearchQuery('simple query')).toEqual({
      term: 'simple query',
      tags: [],
    })
  })

  it('extracts unquoted project: directive', () => {
    expect(parseSearchQuery('table notes project:work')).toEqual({
      term: 'table notes',
      project: 'work',
      tags: [],
    })
  })

  it('extracts quoted project: directive with spaces', () => {
    expect(parseSearchQuery('project:"Design System" button component')).toEqual({
      term: 'button component',
      project: 'Design System',
      tags: [],
    })
  })

  it('interprets project:none and project:unfiled as null', () => {
    expect(parseSearchQuery('meeting notes project:none')).toEqual({
      term: 'meeting notes',
      project: null,
      tags: [],
    })
    expect(parseSearchQuery('meeting notes project:unfiled')).toEqual({
      term: 'meeting notes',
      project: null,
      tags: [],
    })
  })

  it('extracts #tag and tag: directives', () => {
    expect(parseSearchQuery('alignment #gfm #table tag:spec')).toEqual({
      term: 'alignment',
      tags: ['gfm', 'table', 'spec'],
    })
  })

  it('extracts quoted tag: directives', () => {
    expect(parseSearchQuery('tag:"user research" notes')).toEqual({
      term: 'notes',
      tags: ['user research'],
    })
  })

  it('extracts project and tags together', () => {
    expect(parseSearchQuery('project:Research #v1 #draft quarterly report')).toEqual({
      term: 'quarterly report',
      project: 'Research',
      tags: ['v1', 'draft'],
    })
  })

  it('handles empty query', () => {
    expect(parseSearchQuery('')).toEqual({
      term: '',
      tags: [],
    })
    expect(parseSearchQuery('   ')).toEqual({
      term: '',
      tags: [],
    })
  })

  it('handles query containing only directives', () => {
    expect(parseSearchQuery('project:work #urgent')).toEqual({
      term: '',
      project: 'work',
      tags: ['urgent'],
    })
  })
})
