import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { putDocument } from '../db/documents'
import { SearchPanel } from '../components/search/SearchPanel'
import { invalidateIndex, resetIndex } from '../search/store'
import { makeDocument, resetDatabase } from './dbHarness'

afterEach(cleanup)

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

const seed = async () => {
  const searchable = makeDocument({
    title: 'Table editing notes',
    project: 'Work',
    tags: ['gfm', 'spec'],
    doc: paragraphs(
      'GFM tables store alignment in the delimiter row.',
      'A literal pipe breaks the file.',
    ),
  })
  await putDocument(searchable)
  const unrelated = makeDocument({
    title: 'Unrelated',
    project: 'Personal',
    tags: ['hobby'],
    doc: paragraphs('Nothing to see about penguins.'),
  })
  await putDocument(unrelated)
  return { searchable, unrelated }
}

const setup = async () => {
  const { searchable, unrelated } = await seed()
  const onClose = vi.fn()
  const onOpenHit = vi.fn()
  const flushPendingWrites = vi.fn().mockResolvedValue(undefined)
  const allDocs = [searchable, unrelated]

  const panel = (storageRevision: number, docList = allDocs) => (
    <SearchPanel
      onClose={onClose}
      onOpenHit={onOpenHit}
      flushPendingWrites={flushPendingWrites}
      storageRevision={storageRevision}
      corpusCount={docList.length}
      documents={docList}
    />
  )
  const view = render(panel(0))

  return {
    searchable,
    unrelated,
    onClose,
    onOpenHit,
    flushPendingWrites,
    refresh: (storageRevision: number) => view.rerender(panel(storageRevision)),
    user: userEvent.setup(),
    input: screen.getByLabelText('Search query'),
  }
}

const hits = () => screen.queryAllByRole('button', { name: /./ }).filter(
  node => node.className.includes('search-panel__hit'),
)

describe('SearchPanel', () => {
  it('opens focused, with guidance instead of results', async () => {
    const { input } = await setup()
    expect(document.activeElement).toBe(input)
    expect(screen.getByText(/Search the text of every document/)).toBeTruthy()
  })

  it('flushes pending autosaves before the first query', async () => {
    const { user, input, flushPendingWrites } = await setup()
    await user.type(input, 'alignment')
    await waitFor(() => expect(flushPendingWrites).toHaveBeenCalled())
  })

  it('groups matches under the document they came from', async () => {
    const { user, input } = await setup()
    await user.type(input, 'alignment')

    await waitFor(() => expect(hits().length).toBeGreaterThan(0))
    expect(screen.getByText('Table editing notes')).toBeTruthy()
    expect(screen.queryByText('Unrelated')).toBeNull()
  })

  it('marks the matched words in the snippet', async () => {
    const { user, input } = await setup()
    await user.type(input, 'alignment')

    await waitFor(() => expect(hits().length).toBeGreaterThan(0))
    const marks = document.querySelectorAll('.search-panel__snippet mark')
    expect([...marks].map(mark => mark.textContent)).toContain('alignment')
  })

  it('hands the chosen hit back with the query that found it', async () => {
    const { user, input, onOpenHit, onClose } = await setup()
    await user.type(input, 'alignment')

    await waitFor(() => expect(hits().length).toBeGreaterThan(0))
    await user.click(hits()[0])

    expect(onOpenHit).toHaveBeenCalledTimes(1)
    const hit = onOpenHit.mock.calls[0][0]
    expect(hit.term).toBe('alignment')
    expect(hit.passage.text).toContain('alignment')
    // The panel closes itself; the caller does not have to.
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the highlighted row on Enter', async () => {
    const { user, input, onOpenHit } = await setup()
    await user.type(input, 'alignment')

    await waitFor(() => expect(hits().length).toBeGreaterThan(0))
    await user.keyboard('{Enter}')
    expect(onOpenHit).toHaveBeenCalledTimes(1)
  })

  it('walks rows with the arrow keys across document groups', async () => {
    const { user, input } = await setup()
    await user.type(input, 'the')

    await waitFor(() => expect(hits().length).toBeGreaterThan(1))
    expect(hits()[0].getAttribute('aria-current')).toBe('true')

    await user.keyboard('{ArrowDown}')
    expect(hits()[1].getAttribute('aria-current')).toBe('true')
  })

  it('says so when nothing matches', async () => {
    const { user, input } = await setup()
    await user.type(input, 'zzzznothing')
    await waitFor(() => expect(screen.getByText(/No matches for/)).toBeTruthy())
  })

  it('narrows to comments when the Comments chip is picked', async () => {
    const { user, input } = await setup()
    await user.type(input, 'alignment')
    await waitFor(() => expect(hits().length).toBeGreaterThan(0))

    await user.click(screen.getByRole('tab', { name: /Comments/ }))
    // There are no comments in this fixture, so the corpus filter empties it.
    await waitFor(() => expect(screen.getByText(/No matches for/)).toBeTruthy())
  })

  it('clears results when the query is emptied', async () => {
    const { user, input } = await setup()
    await user.type(input, 'alignment')
    await waitFor(() => expect(hits().length).toBeGreaterThan(0))

    await user.clear(input)
    await waitFor(() =>
      expect(screen.getByText(/Search the text of every document/)).toBeTruthy(),
    )
  })

  it('caps hits per document and expands on demand', async () => {
    const { user, input } = await setup()
    const manyHits = makeDocument({
      title: 'Alignment everywhere',
      doc: paragraphs(
        'First alignment paragraph here.',
        'Second alignment paragraph here.',
        'Third alignment paragraph here.',
        'Fourth alignment paragraph here.',
        'Fifth alignment paragraph here.',
      ),
    })
    await putDocument(manyHits)

    await user.type(input, 'alignment')
    const more = await screen.findByRole('button', { name: /more in this document/ })
    const beforeCount = hits().length

    await user.click(more)
    await waitFor(() => expect(hits().length).toBeGreaterThan(beforeCount))
    expect(
      screen.queryByRole('button', { name: /more in this document/ }),
    ).toBeNull()
  })

  it('never repeats the document title in a hit\'s hint', async () => {
    const { user, input } = await setup()
    const withHeading = makeDocument({
      title: 'Big Heading',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Big Heading' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Some quarterly figures here.' }],
          },
        ],
      },
    })
    await putDocument(withHeading)

    await user.type(input, 'quarterly')
    await waitFor(() => expect(hits().length).toBeGreaterThan(0))

    const hints = document.querySelectorAll('.search-panel__hint')
    for (const hint of hints) {
      expect(hint.textContent?.startsWith('Big Heading')).toBe(false)
    }
  })

  it('reruns an open query when vault sync replaces storage', async () => {
    const { searchable, user, input, refresh } = await setup()
    await user.type(input, 'alignment')
    await waitFor(() => expect(hits().length).toBeGreaterThan(0))

    await putDocument({
      ...searchable,
      doc: paragraphs('The remotely synced version discusses puffins.'),
      markdown: 'The remotely synced version discusses puffins.\n',
      updatedAt: searchable.updatedAt + 1,
    })
    invalidateIndex()
    refresh(1)

    await waitFor(() => expect(screen.getByText(/No matches for/)).toBeTruthy())
  })

  it('filters results by project dropdown', async () => {
    const { user, input } = await setup()
    await user.type(input, 'alignment')
    await waitFor(() => expect(hits().length).toBeGreaterThan(0))

    const projectSelect = screen.getByLabelText('Filter by project')
    await user.selectOptions(projectSelect, 'Work')

    await waitFor(() => expect(hits().length).toBeGreaterThan(0))
    expect(screen.getByText('Table editing notes')).toBeTruthy()

    // Select different project
    await user.selectOptions(projectSelect, 'Personal')
    await waitFor(() => expect(screen.getByText(/No matches for/)).toBeTruthy())

    // Select All projects again
    await user.selectOptions(projectSelect, '')
    await waitFor(() => expect(hits().length).toBeGreaterThan(0))
  })

  it('filters results by tag chips', async () => {
    const { user, input } = await setup()
    await user.type(input, 'alignment')
    await waitFor(() => expect(hits().length).toBeGreaterThan(0))

    const gfmChip = screen.getByRole('button', { name: /Filter by #gfm/ })
    await user.click(gfmChip)

    await waitFor(() => expect(hits().length).toBeGreaterThan(0))
    expect(gfmChip.getAttribute('aria-pressed')).toBe('true')

    const hobbyChip = screen.getByRole('button', { name: /Filter by #hobby/ })
    await user.click(hobbyChip)

    // AND semantics: no doc has both gfm and hobby
    await waitFor(() => expect(screen.getByText(/No matches for/)).toBeTruthy())
  })

  it('filters via query directives project: and #tag', async () => {
    const { user, input } = await setup()
    await user.type(input, 'alignment project:Work #gfm')

    await waitFor(() => expect(hits().length).toBeGreaterThan(0))
    expect(screen.getByText('Table editing notes')).toBeTruthy()

    // Clear and type non-matching project
    await user.clear(input)
    await user.type(input, 'alignment project:Personal')
    await waitFor(() => expect(screen.getByText(/No matches for/)).toBeTruthy())
  })

  it('displays active filter badges and clears them', async () => {
    const { user, input } = await setup()
    await user.type(input, 'alignment project:Work #gfm')

    await waitFor(() => expect(screen.getByText('Active filters:')).toBeTruthy())
    expect(
      screen.getByRole('button', { name: 'Remove project filter' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Remove tag filter #gfm' }),
    ).toBeTruthy()

    const clearBtn = screen.getByRole('button', { name: 'Clear filters' })
    await user.click(clearBtn)

    await waitFor(() =>
      expect(screen.queryByText('Active filters:')).toBeNull(),
    )
  })

  it('filters by clicking project or tag badge on a result document header', async () => {
    const { user, input } = await setup()
    await user.type(input, 'alignment')
    await waitFor(() => expect(hits().length).toBeGreaterThan(0))

    const docProjectBadge = screen.getByTitle('Filter by project: Work')
    await user.click(docProjectBadge)

    await waitFor(() =>
      expect(screen.getByText('Active filters:')).toBeTruthy(),
    )
    expect(
      screen.getByRole('button', { name: 'Remove project filter' }),
    ).toBeTruthy()
  })
})
