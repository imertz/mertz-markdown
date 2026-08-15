import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentLibrary } from '../components/documents/DocumentLibrary'
import { UNTITLED } from '../lib/title'
import type { DocumentRecord } from '../types'
import { makeDocument } from './dbHarness'

/**
 * What the library does once there are too many rows to scan.
 *
 * Two different failures, and they need different answers. A long group is
 * undifferentiated, so it gets dated headings. A run of blank drafts is
 * indistinguishable — identical title, identical time, by construction — so it
 * gets counted instead of listed.
 */

afterEach(cleanup)

const DAY = 86_400_000

const setup = (documents: DocumentRecord[], activeId: string | null = null) => {
  const handlers = {
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    onDestroy: vi.fn(),
    onRename: vi.fn(),
    onSetProject: vi.fn(),
    onSetTags: vi.fn(),
    onRenameProject: vi.fn(),
    onRenameTag: vi.fn(),
  }

  render(
    <DocumentLibrary
      documents={documents}
      trashed={[]}
      activeId={activeId}
      {...handlers}
    />,
  )

  return { ...handlers, user: userEvent.setup() }
}

/** Nine written documents, aged so they land in more than one bucket. */
const aged = (): DocumentRecord[] => {
  const now = Date.now()
  return Array.from({ length: 9 }, (_, index) =>
    makeDocument({
      title: `Document ${index}`,
      markdown: `Document ${index}`,
      // The first two today, the rest spread back over a fortnight.
      updatedAt: now - (index < 2 ? 0 : index * 2 * DAY),
    }),
  )
}

const blank = (count: number): DocumentRecord[] =>
  Array.from({ length: count }, () => makeDocument({ title: UNTITLED }))

describe('dated buckets', () => {
  it('dates a long group so it reads as several short lists', () => {
    setup(aged())

    const labels = screen
      .getAllByRole('heading', { level: 4 })
      .map(node => node.textContent)

    expect(labels).toContain('Today')
    expect(labels).toContain('Earlier')
  })

  it('leaves a short group alone', () => {
    // Four rows are already one glance; dating them would be ceremony.
    setup(aged().slice(0, 4))

    expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0)
  })

  it('says nothing when every document lands in the same day', () => {
    const now = Date.now()
    setup(
      Array.from({ length: 9 }, (_, index) =>
        makeDocument({
          title: `Fresh ${index}`,
          markdown: 'x',
          updatedAt: now,
        }),
      ),
    )

    // A partition of one is not a partition.
    expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0)
    expect(screen.getByText('Fresh 8')).toBeTruthy()
  })

  it('leaves the row to say the hour, not how long ago', () => {
    const now = Date.now()
    setup(aged())

    // "20m ago" nine times over is the heading repeating itself; the clock is
    // the part TODAY has not already said.
    const clock = new Date(now).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
    expect(screen.getAllByText(clock).length).toBeGreaterThan(0)
    expect(screen.queryByText('just now')).toBeNull()
  })

  it('keeps "how long ago" for a list that has no heading over it', () => {
    setup(aged().slice(0, 2))

    expect(screen.getAllByText('just now').length).toBeGreaterThan(0)
  })

  it('drops the headings while a filter is on', async () => {
    const { user } = setup(aged())

    await user.type(screen.getByLabelText('Filter documents'), 'Document')

    // A result set is ranked by match, so dating it would be describing an
    // order the list is no longer in.
    expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0)
  })
})

describe('the standing tools', () => {
  it('keeps the filter and the new-document button out of the scroll', () => {
    const { container } = render(
      <DocumentLibrary
        documents={aged()}
        trashed={[]}
        activeId={null}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRestore={vi.fn()}
        onDestroy={vi.fn()}
        onRename={vi.fn()}
        onSetProject={vi.fn()}
        onSetTags={vi.fn()}
        onRenameProject={vi.fn()}
        onRenameTag={vi.fn()}
      />,
    )

    // The two things you reach for while reading a long library used to be the
    // first casualties of scrolling it.
    const tools = container.querySelector('.library__tools')
    expect(tools?.contains(screen.getByLabelText('Filter documents'))).toBe(true)
    expect(
      tools?.contains(screen.getByRole('button', { name: 'New document' })),
    ).toBe(true)
    expect(container.querySelector('.library__body')?.contains(tools!)).toBe(
      false,
    )
  })

  it('gives the button the whole row when there is nothing to filter', () => {
    setup(aged().slice(0, 3))

    expect(screen.queryByLabelText('Filter documents')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'New document' }).textContent,
    ).toBe('+ New document')
  })
})

describe('blank drafts', () => {
  it('counts them instead of listing them', () => {
    setup([...blank(4), ...aged().slice(0, 2)])

    expect(screen.getByRole('button', { name: /4 empty drafts/ })).toBeTruthy()
    expect(screen.queryByText(UNTITLED)).toBeNull()
  })

  it('opens the fold on a click and keeps every row usable', async () => {
    const drafts = blank(3)
    const { user, onSelect } = setup(drafts)

    await user.click(screen.getByRole('button', { name: /3 empty drafts/ }))
    const rows = screen.getAllByText(UNTITLED)
    expect(rows).toHaveLength(3)

    await user.click(rows[0]!)
    expect(onSelect).toHaveBeenCalledWith(drafts[0]?.id)
  })

  it('never folds away the document that is open', () => {
    const drafts = blank(3)
    setup(drafts, drafts[0]?.id ?? null)

    // The open document is the one row whose state the user can see the effect
    // of, so it stays out on its own while the other two fold.
    expect(screen.getByText(UNTITLED)).toBeTruthy()
    expect(screen.getByRole('button', { name: /2 empty drafts/ })).toBeTruthy()
  })

  it('folds a section that is nothing but drafts without leaving a rule behind', () => {
    const { container } = render(
      <DocumentLibrary
        documents={blank(3)}
        trashed={[]}
        activeId={null}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRestore={vi.fn()}
        onDestroy={vi.fn()}
        onRename={vi.fn()}
        onSetProject={vi.fn()}
        onSetTags={vi.fn()}
        onRenameProject={vi.fn()}
        onRenameTag={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /3 empty drafts/ })).toBeTruthy()
    expect(container.querySelectorAll('.doc-picker__list')).toHaveLength(0)
  })

  it('leaves a lone draft in the list', () => {
    // One blank draft is the document you just made, and a fold saves nothing.
    setup([...blank(1), ...aged().slice(0, 2)])

    expect(screen.getByText(UNTITLED)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /empty drafts/ })).toBeNull()
  })

  it('does not fold a document that merely has no first line', () => {
    // An image-only document derives the placeholder title too, and it is not
    // interchangeable with anything.
    setup([
      makeDocument({ title: UNTITLED, markdown: '![](a.png)' }),
      makeDocument({ title: UNTITLED, markdown: '![](b.png)' }),
    ])

    expect(screen.getAllByText(UNTITLED)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /empty drafts/ })).toBeNull()
  })
})
