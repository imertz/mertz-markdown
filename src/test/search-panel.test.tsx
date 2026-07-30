import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { putDocument } from '../db/documents'
import { SearchPanel } from '../components/search/SearchPanel'
import { resetIndex } from '../search/store'
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
  await putDocument(
    makeDocument({
      title: 'Table editing notes',
      doc: paragraphs(
        'GFM tables store alignment in the delimiter row.',
        'A literal pipe breaks the file.',
      ),
    }),
  )
  await putDocument(
    makeDocument({
      title: 'Unrelated',
      doc: paragraphs('Nothing to see about penguins.'),
    }),
  )
}

const setup = async () => {
  await seed()
  const onClose = vi.fn()
  const onOpenHit = vi.fn()
  const flushPendingWrites = vi.fn().mockResolvedValue(undefined)

  render(
    <SearchPanel
      onClose={onClose}
      onOpenHit={onOpenHit}
      flushPendingWrites={flushPendingWrites}
    />,
  )

  return {
    onClose,
    onOpenHit,
    flushPendingWrites,
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
})
