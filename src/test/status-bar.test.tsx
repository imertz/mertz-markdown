import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from '../components/StatusBar'
import type { OutlineEntry } from '../editor/outline'
import type { DocumentStats } from '../hooks/useDocumentStats'

const heading = (text: string, level = 2, pos = 0): OutlineEntry => ({
  pos,
  end: pos + text.length + 2,
  level,
  text,
})

const OUTLINE: OutlineEntry[] = [
  heading('Field Guide', 1, 0),
  heading('Installation', 2, 40),
  heading('Prerequisites', 3, 80),
]

const stats = (overrides: Partial<DocumentStats> = {}): DocumentStats => ({
  words: 0,
  selectedWords: 0,
  minutes: 0,
  outline: [],
  activeIndex: -1,
  ...overrides,
})

type Props = Parameters<typeof StatusBar>[0]

const setup = (overrides: Partial<Props> = {}) => {
  const handlers = {
    onNextThread: vi.fn(),
    onShowOrphans: vi.fn(),
    onJumpToHeading: vi.fn(),
    onStepSection: vi.fn(),
    onToggleRail: vi.fn(),
  }

  const view = render(
    <StatusBar
      stats={stats()}
      openCount={0}
      resolvedCount={0}
      orphanCount={0}
      online={true}
      status="saved"
      persistence="persisted"
      savedAt={null}
      usage={null}
      railHidden={false}
      {...handlers}
      {...overrides}
    />,
  )

  return { ...handlers, ...view }
}

afterEach(cleanup)

describe('status bar readout', () => {
  it('shows the word count and reading time', () => {
    setup({ stats: stats({ words: 240, minutes: 1 }) })

    expect(screen.getByText(/240 words · 1 min/)).toBeTruthy()
  })

  it('omits reading time for an empty document', () => {
    setup({ stats: stats({ words: 0, minutes: 0 }) })

    expect(screen.getByText('0 words')).toBeTruthy()
  })

  it('switches to a selection count while text is selected', () => {
    setup({ stats: stats({ words: 240, selectedWords: 12, minutes: 1 }) })

    expect(screen.getByText(/12 of 240 words/)).toBeTruthy()
  })

  it('singularises a one-word document', () => {
    setup({ stats: stats({ words: 1, minutes: 1 }) })

    expect(screen.getByText(/^1 word ·/)).toBeTruthy()
  })
})

describe('status bar section navigation', () => {
  it('names the caret’s section on the outline trigger', () => {
    setup({ stats: stats({ outline: OUTLINE, activeIndex: 1 }) })

    expect(screen.getByText('Installation')).toBeTruthy()
  })

  it('names no section above the first heading', () => {
    setup({ stats: stats({ outline: OUTLINE, activeIndex: -1 }) })

    expect(screen.queryByText('Field Guide')).toBeNull()
    // The trigger is still there — there are headings to jump to.
    expect(
      screen.getByRole('button', { name: 'Document outline' }),
    ).not.toHaveProperty('disabled', true)
  })

  it('disables the outline when the document has no headings', () => {
    setup({ stats: stats({ outline: [], activeIndex: -1 }) })

    const trigger = screen.getByRole('button', { name: 'Document outline' })
    expect(trigger).toHaveProperty('disabled', true)
  })

  it('lists every heading and marks the current one', async () => {
    const user = userEvent.setup()
    setup({ stats: stats({ outline: OUTLINE, activeIndex: 1 }) })

    await user.click(screen.getByRole('button', { name: 'Document outline' }))

    const items = screen.getAllByRole('menuitem')
    expect(items.map(item => item.textContent)).toEqual([
      'Field Guide',
      'Installation',
      'Prerequisites',
    ])
    expect(items[1].getAttribute('aria-current')).toBe('true')
  })

  it('jumps by index when an entry is picked, then closes', async () => {
    const user = userEvent.setup()
    const { onJumpToHeading } = setup({
      stats: stats({ outline: OUTLINE, activeIndex: 0 }),
    })

    await user.click(screen.getByRole('button', { name: 'Document outline' }))
    await user.click(screen.getByRole('menuitem', { name: 'Prerequisites' }))

    expect(onJumpToHeading).toHaveBeenCalledWith(2)
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('closes the outline on Escape', async () => {
    const user = userEvent.setup()
    setup({ stats: stats({ outline: OUTLINE, activeIndex: 0 }) })

    await user.click(screen.getByRole('button', { name: 'Document outline' }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('steps to the previous and next section', async () => {
    const user = userEvent.setup()
    const { onStepSection } = setup({
      stats: stats({ outline: OUTLINE, activeIndex: 1 }),
    })

    await user.click(screen.getByRole('button', { name: 'Previous section' }))
    await user.click(screen.getByRole('button', { name: 'Next section' }))

    expect(onStepSection).toHaveBeenNthCalledWith(1, -1)
    expect(onStepSection).toHaveBeenNthCalledWith(2, 1)
  })

  it('disables the arrows at each end of the document', () => {
    const { unmount } = render(
      <StatusBar
        stats={stats({ outline: OUTLINE, activeIndex: -1 })}
        openCount={0}
        resolvedCount={0}
        orphanCount={0}
        online={true}
        status="saved"
        persistence="persisted"
        savedAt={null}
        usage={null}
        railHidden={false}
        onNextThread={vi.fn()}
        onShowOrphans={vi.fn()}
        onJumpToHeading={vi.fn()}
        onStepSection={vi.fn()}
        onToggleRail={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Previous section' }),
    ).toHaveProperty('disabled', true)
    unmount()

    setup({ stats: stats({ outline: OUTLINE, activeIndex: 2 }) })
    expect(screen.getByRole('button', { name: 'Next section' })).toHaveProperty(
      'disabled',
      true,
    )
  })
})

describe('status bar comment chips', () => {
  it('hides the comment chip when there is nothing to jump to', () => {
    setup({ openCount: 0 })

    expect(screen.queryByRole('button', { name: /^\d+ comments?$/ })).toBeNull()
  })

  it('jumps to the next thread when the comment chip is clicked', async () => {
    const user = userEvent.setup()
    const { onNextThread } = setup({ openCount: 3 })

    await user.click(screen.getByRole('button', { name: '3 comments' }))

    expect(onNextThread).toHaveBeenCalledTimes(1)
  })

  it('hides the orphan chip until a thread is actually orphaned', () => {
    setup({ orphanCount: 0 })

    expect(screen.queryByRole('button', { name: /orphaned/i })).toBeNull()
  })

  it('reveals orphans when the orphan chip is clicked', async () => {
    const user = userEvent.setup()
    const { onShowOrphans } = setup({ openCount: 2, orphanCount: 1 })

    await user.click(screen.getByRole('button', { name: '1 orphaned' }))

    expect(onShowOrphans).toHaveBeenCalledTimes(1)
  })
})

describe('status bar rail toggle', () => {
  it('reports the rail as shown', () => {
    setup({ railHidden: false })

    const toggle = screen.getByRole('button', { name: 'Hide comments' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('carries the count in its name while the rail is hidden', () => {
    // Deliberately not a visible badge — the comment chip beside it already
    // shows the number, so this would read "1 comment [1]".
    setup({ railHidden: true, openCount: 1 })

    const toggle = screen.getByRole('button', { name: 'Show comments (1)' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('omits the count when there is nothing open', () => {
    setup({ railHidden: true, openCount: 0 })

    expect(screen.getByRole('button', { name: 'Show comments' })).toBeTruthy()
  })

  it('toggles when clicked', async () => {
    const user = userEvent.setup()
    const { onToggleRail } = setup({ railHidden: false })

    await user.click(screen.getByRole('button', { name: 'Hide comments' }))

    expect(onToggleRail).toHaveBeenCalledTimes(1)
  })
})

describe('status bar state', () => {
  it('shows the offline chip only while offline', () => {
    const { unmount } = setup({ online: false })
    expect(screen.getByText('Offline')).toBeTruthy()
    unmount()

    setup({ online: true })
    expect(screen.queryByText('Offline')).toBeNull()
  })

  it('dates the save state once a write has landed', () => {
    setup({ status: 'saved', savedAt: Date.now() - 5 * 60_000 })

    expect(screen.getByText('Saved 5m ago')).toBeTruthy()
  })

  it('leaves a pending write undated', () => {
    // Mid-save, the interesting fact is the write in flight, not how long ago
    // the previous one finished.
    setup({ status: 'saving', savedAt: Date.now() - 5 * 60_000 })

    expect(screen.getByText('Saving…')).toBeTruthy()
  })
})
