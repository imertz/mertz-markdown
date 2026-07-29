import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommentSidebar } from '../components/comments/CommentSidebar'
import type { ThreadWithComments } from '../types'

/**
 * Every card, the open draft included, is absolutely positioned at its anchor's
 * y-offset by the sidebar's layout pass.
 *
 * The draft used to be an exception: it sat in normal flow at the top of the
 * rail, and its composer autofocuses — so the browser scrolled the nearest
 * scrollable ancestor, the `.workspace` that holds the editor *and* the rail,
 * all the way up to reach it. Clicking "Comment" threw the document back to the
 * top of the page. The draft is now measured from `draftRange` (it has no mark
 * until it is submitted), and its composer focuses with `preventScroll`.
 *
 * The positioning itself lives in CSS, which happy-dom does not lay out, so
 * these tests guard the wiring rather than the geometry. The absence of overlap
 * was verified against a real browser.
 */

const thread = (id: string, exact: string): ThreadWithComments => ({
  id,
  docId: 'doc-1',
  status: 'open',
  selector: { exact, prefix: '', suffix: '' },
  createdAt: 1,
  updatedAt: 1,
  resolvedAt: null,
  orphanedAt: null,
  comments: [
    {
      id: `${id}-c1`,
      threadId: id,
      docId: 'doc-1',
      body: `Comment on ${exact}`,
      author: 'You',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
})

const setup = (draftRange: { from: number; to: number } | null) => {
  const { container } = render(
    <CommentSidebar
      editor={null}
      threads={[thread('t1', 'encrypted'), thread('t2', 'credential')]}
      activeId={null}
      draftRange={draftRange}
      showResolved={false}
      onToggleResolved={vi.fn()}
      onActivate={vi.fn()}
      onSubmitDraft={vi.fn()}
      onCancelDraft={vi.fn()}
      onReply={vi.fn()}
      onEdit={vi.fn()}
      onResolve={vi.fn()}
      onResolveAll={vi.fn()}
      onDelete={vi.fn()}
      onReanchor={vi.fn()}
    />,
  )
  return container.querySelector('.comment-rail') as HTMLElement
}

afterEach(cleanup)

describe('comment rail drafting state', () => {
  it('focuses the draft composer without scrolling to it', () => {
    // The regression: a plain focus() scrolls the workspace so the textarea is
    // visible, and at that moment the card has not been positioned yet — the
    // layout pass runs in a layout effect, which React may run *after* this
    // passive effect. So it scrolled to where an unpositioned card sits: the
    // top of the rail, and with it the top of the document.
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus')

    setup({ from: 1, to: 5 })

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    focus.mockRestore()
  })

  it('renders the draft card above the existing threads', () => {
    const rail = setup({ from: 1, to: 5 })
    const cards = [...rail.querySelectorAll('.thread-card')]

    expect(cards).toHaveLength(3)
    expect(cards[0].classList.contains('thread-card--draft')).toBe(true)
  })

  it('watches card size so a height change triggers a relayout', () => {
    // Card heights feed the collision pass, but the editor-side ResizeObserver
    // cannot see a card grow (opening a reply composer changes nothing in the
    // document). Without observing the cards themselves, everything below keeps
    // a stale top and the taller card overlaps it.
    const observed: Element[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(element: Element) {
          observed.push(element)
        }
        unobserve() {}
        disconnect() {}
      },
    )

    setup(null)

    expect(
      observed.some(element => element.classList.contains('thread-card')),
    ).toBe(true)
    vi.unstubAllGlobals()
  })

  it('size-observes the draft card too', () => {
    // The draft takes part in the collision pass like any other card, so its
    // height has to be measurable — and it changes as the textarea grows.
    const observed: Element[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(element: Element) {
          observed.push(element)
        }
        unobserve() {}
        disconnect() {}
      },
    )

    setup({ from: 1, to: 5 })

    expect(
      observed.some(element =>
        element.classList.contains('thread-card--draft'),
      ),
    ).toBe(true)
    vi.unstubAllGlobals()
  })
})
