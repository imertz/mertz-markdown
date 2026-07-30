import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PEEK_DELAY_MS, usePeek } from '../keys/usePeek'

/**
 * The state machine behind the hold-a-modifier panel.
 *
 * Most of these are about it *not* appearing: over a text field, while a
 * capital is being typed, while AltGr is reaching for a character. A panel that
 * shows up uninvited during typing would be worse than no panel at all.
 */

let surface: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  surface = document.createElement('div')
  surface.innerHTML = `
    <div class="ProseMirror" contenteditable="true"><p id="para">text</p></div>
    <div data-keys="overlay"><input id="panel" /></div>
  `
  document.body.append(surface)
})

afterEach(() => {
  cleanup()
  surface.remove()
  vi.useRealTimers()
})

const at = (id: string) => surface.querySelector(`#${id}`) as Element

interface KeyInit {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
  altGraph?: boolean
  target?: Element
}

function fire(type: 'keydown' | 'keyup', init: KeyInit) {
  const { altGraph = false, target, ...rest } = init
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    ...rest,
  })
  Object.defineProperty(event, 'getModifierState', {
    value: (name: string) => name === 'AltGraph' && altGraph,
  })
  act(() => {
    ;(target ?? at('para')).dispatchEvent(event)
  })
}

const wait = () =>
  act(() => {
    vi.advanceTimersByTime(PEEK_DELAY_MS)
  })

describe('usePeek', () => {
  it('opens after the modifier is held long enough', () => {
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true })
    expect(result.current).toBeNull()

    wait()
    expect(result.current).toEqual({ mod: true, alt: false, shift: false })
  })

  it('stays shut for a modifier released before the delay', () => {
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true })
    fire('keyup', { key: 'Meta' })
    wait()

    expect(result.current).toBeNull()
  })

  it('is cancelled by a real keystroke during the wait', () => {
    // Holding ⌘ on the way to ⌘S must never flash a panel.
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true })
    fire('keydown', { key: 's', metaKey: true })
    wait()

    expect(result.current).toBeNull()
  })

  it('closes when a command is run off it', () => {
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true })
    wait()
    fire('keydown', { key: 'k', metaKey: true })

    expect(result.current).toBeNull()
  })

  it('opens with every modifier held by the time it fires', () => {
    /*
     * Reaching for ⌘⌥ presses ⌘ a fraction before ⌥, well inside the delay. A
     * panel that opened from the event that armed it would answer "what does ⌘
     * do" to someone who had already moved on to asking about ⌘⌥.
     */
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true })
    fire('keydown', { key: 'Alt', metaKey: true, altKey: true })
    wait()

    expect(result.current).toEqual({ mod: true, alt: true, shift: false })
  })

  it('re-filters immediately when a modifier is added', () => {
    // No second wait: the reader is already asking.
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true })
    wait()
    fire('keydown', { key: 'Alt', metaKey: true, altKey: true })

    expect(result.current).toEqual({ mod: true, alt: true, shift: false })
  })

  it('re-filters when a modifier is dropped', () => {
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true })
    fire('keydown', { key: 'Alt', metaKey: true, altKey: true })
    wait()
    fire('keyup', { key: 'Alt', metaKey: true })

    expect(result.current).toEqual({ mod: true, alt: false, shift: false })
  })

  it('never arms for Shift alone, which is how a capital is typed', () => {
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Shift', shiftKey: true })
    wait()

    expect(result.current).toBeNull()
  })

  it('never arms for Alt alone, which is a macOS dead key', () => {
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Alt', altKey: true })
    wait()

    expect(result.current).toBeNull()
  })

  it('never arms for AltGr, which Windows spells as Ctrl+Alt', () => {
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', {
      key: 'Alt',
      ctrlKey: true,
      altKey: true,
      altGraph: true,
    })
    wait()

    expect(result.current).toBeNull()
  })

  it('never arms over a panel that owns its own keyboard', () => {
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true, target: at('panel') })
    wait()

    expect(result.current).toBeNull()
  })

  it('never arms while disabled', () => {
    const { result } = renderHook(() => usePeek(false))

    fire('keydown', { key: 'Meta', metaKey: true })
    wait()

    expect(result.current).toBeNull()
  })

  it('closes when an overlay opens under it', () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => usePeek(enabled),
      { initialProps: { enabled: true } },
    )

    fire('keydown', { key: 'Meta', metaKey: true })
    wait()
    expect(result.current).not.toBeNull()

    rerender({ enabled: false })
    expect(result.current).toBeNull()
  })

  it('does not re-arm on the auto-repeat of a held modifier', () => {
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true })
    act(() => {
      vi.advanceTimersByTime(PEEK_DELAY_MS - 50)
    })
    // A repeat that restarted the timer would push the panel out forever.
    fire('keydown', { key: 'Meta', metaKey: true, repeat: true })
    act(() => {
      vi.advanceTimersByTime(50)
    })

    expect(result.current).not.toBeNull()
  })

  it('closes when the window loses focus, the ⌘Tab case', () => {
    // The Meta keyup lands in the other application and never arrives here, so
    // without this the panel would sit on screen indefinitely.
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true })
    wait()
    expect(result.current).not.toBeNull()

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    expect(result.current).toBeNull()
  })

  it('closes when the tab is hidden', () => {
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true })
    wait()

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current).toBeNull()
  })

  it('closes on a modifier-click, which is not a question', () => {
    const { result } = renderHook(() => usePeek(true))

    fire('keydown', { key: 'Meta', metaKey: true })
    wait()

    act(() => {
      window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(result.current).toBeNull()
  })

  it('stops listening on unmount', () => {
    const { result, unmount } = renderHook(() => usePeek(true))

    unmount()
    fire('keydown', { key: 'Meta', metaKey: true })
    wait()

    expect(result.current).toBeNull()
  })
})
