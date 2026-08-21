import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReadingModeControls } from '../components/ReadingMode'
import { useReadingMode } from '../hooks/useReadingMode'
import { resetDatabase } from './dbHarness'

// The real hook imports a Vite PWA virtual module that only resolves in the
// app build, not under vitest.
vi.mock('../hooks/usePwaUpdate', () => ({
  usePwaUpdate: () => ({
    needRefresh: false,
    offlineReady: false,
    update: async () => {},
    dismissUpdate: () => {},
    dismissOfflineReady: () => {},
  }),
}))

const { AppShell } = await import('../components/AppShell')

afterEach(async () => {
  cleanup()
  localStorage.clear()
  delete document.documentElement.dataset.readingMode
  await resetDatabase()
})

/** Escape, delivered from wherever focus actually was. */
function pressEscape(target: EventTarget = window) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  )
}

describe('useReadingMode', () => {
  it('starts off, and marks the documentElement when it is on', () => {
    const { result } = renderHook(() => useReadingMode())

    expect(result.current.on).toBe(false)
    expect(document.documentElement.dataset.readingMode).toBeUndefined()

    act(() => result.current.toggle())

    expect(result.current.on).toBe(true)
    expect(document.documentElement.dataset.readingMode).toBe('on')
  })

  it('clears the attribute on the way out', () => {
    const { result } = renderHook(() => useReadingMode())

    act(() => result.current.toggle())
    act(() => result.current.exit())

    expect(result.current.on).toBe(false)
    expect(document.documentElement.dataset.readingMode).toBeUndefined()
  })

  it('does not survive a reload', () => {
    // The one place this parts company with focus mode and the theme: a cold
    // start into a page with no header is a reader wondering what broke.
    const first = renderHook(() => useReadingMode())
    act(() => first.result.current.toggle())
    first.unmount()

    expect(localStorage.length).toBe(0)
    const second = renderHook(() => useReadingMode())
    expect(second.result.current.on).toBe(false)
  })

  it('leaves on Escape', () => {
    const { result } = renderHook(() => useReadingMode())
    act(() => result.current.toggle())

    act(() => pressEscape())

    expect(result.current.on).toBe(false)
  })

  it('ignores Escape while an overlay owns the screen', () => {
    // The palette and the find bar close on their own Escape. Answering it
    // here too would take the reader out of the document behind them in the
    // same keystroke.
    const overlay = document.createElement('div')
    overlay.dataset.keys = 'overlay'
    const input = document.createElement('input')
    overlay.append(input)
    document.body.append(overlay)

    const { result } = renderHook(() => useReadingMode())
    act(() => result.current.toggle())

    act(() => pressEscape(input))

    expect(result.current.on).toBe(true)
    overlay.remove()
  })

  it('ignores an Escape something else has already handled', () => {
    const { result } = renderHook(() => useReadingMode())
    act(() => result.current.toggle())

    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
      event.preventDefault()
      window.dispatchEvent(event)
    })

    expect(result.current.on).toBe(true)
  })

  it('stops listening once it is off', () => {
    const { result } = renderHook(() => useReadingMode())

    act(() => pressEscape())

    expect(result.current.on).toBe(false)
  })
})

describe('reading mode controls', () => {
  it('offers a way out that names the key as well', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    render(<ReadingModeControls onExit={onExit} />)

    const exit = screen.getByRole('button', { name: /leave reading mode/i })
    expect(exit.getAttribute('title')).toMatch(/Esc/)

    await user.click(exit)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('draws no progress line for a document that already fits', () => {
    // Nothing to read off, so nothing is drawn — the same rule the status
    // bar's reading scale follows.
    const { container } = render(<ReadingModeControls onExit={vi.fn()} />)

    expect(container.querySelector('.reading-progress')).toBeNull()
  })
})

describe('the shell in reading mode', () => {
  it('takes the panels off the screen and puts them back as they were', async () => {
    const user = userEvent.setup()
    render(<AppShell />)

    // The library starts collapsed, so open it: the claim under test is that
    // the mode borrows the screen rather than resetting the preference.
    await user.click(
      screen.getByRole('button', { name: /Show or hide the library/ }),
    )
    expect(screen.getByRole('complementary', { name: 'Library' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBeTruthy()

    await user.click(
      screen.getByRole('button', { name: /Immersive reading mode/ }),
    )

    expect(document.documentElement.dataset.readingMode).toBe('on')
    expect(screen.queryByRole('complementary', { name: 'Library' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull()

    await user.click(
      screen.getByRole('button', { name: /Leave reading mode/ }),
    )

    expect(document.documentElement.dataset.readingMode).toBeUndefined()
    expect(screen.getByRole('complementary', { name: 'Library' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBeTruthy()
  })
})
