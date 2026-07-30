import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Shortcut } from '../hooks/useGlobalShortcuts'
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts'
import { parseChord } from '../keys/chord'

/**
 * The dispatcher had no tests at all before the shortcut system landed, which
 * is how it kept a bug — every binding fired while the reader was typing in an
 * overlay — for as long as it did.
 */

function bind(spec: string, run: () => void, when?: () => boolean): Shortcut {
  return { ...parseChord(spec), run, when }
}

function press(
  target: EventTarget,
  init: KeyboardEventInit & { defaultPrevented?: boolean },
): KeyboardEvent {
  const { defaultPrevented, ...rest } = init
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...rest,
  })
  if (defaultPrevented) event.preventDefault()
  target.dispatchEvent(event)
  return event
}

let surface: HTMLElement

beforeEach(() => {
  surface = document.createElement('div')
  surface.innerHTML = `
    <div class="ProseMirror" contenteditable="true"><p id="para">text</p></div>
    <div data-keys="overlay"><input id="panel" /></div>
    <button id="button">Bold</button>
  `
  document.body.append(surface)
})

afterEach(() => {
  // Not optional here: a hook left mounted keeps its window listener, and the
  // first one to match calls preventDefault — which the next test's hook then
  // correctly ignores, failing for a reason that has nothing to do with it.
  cleanup()
  surface.remove()
  vi.restoreAllMocks()
})

const at = (id: string) => surface.querySelector(`#${id}`) as Element

describe('useGlobalShortcuts', () => {
  it('runs the matching binding and takes the key from the browser', () => {
    const run = vi.fn()
    renderHook(() => useGlobalShortcuts([bind('mod+s', run)]))

    const event = press(at('para'), { key: 's', code: 'KeyS', metaKey: true })

    expect(run).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not fire when an extra modifier is held', () => {
    const run = vi.fn()
    renderHook(() => useGlobalShortcuts([bind('mod+k', run)]))

    press(at('button'), {
      key: 'k',
      code: 'KeyK',
      metaKey: true,
      shiftKey: true,
    })

    expect(run).not.toHaveBeenCalled()
  })

  it('leaves a key the editor has already handled alone', () => {
    // ProseMirror runs first and marks what it took. Without this the window
    // table would double-handle ⌘B and every other Tiptap chord.
    const run = vi.fn()
    renderHook(() => useGlobalShortcuts([bind('mod+b', run)]))

    press(at('para'), {
      key: 'b',
      code: 'KeyB',
      metaKey: true,
      defaultPrevented: true,
    })

    expect(run).not.toHaveBeenCalled()
  })

  it('stands down while an overlay has focus', () => {
    const run = vi.fn()
    renderHook(() => useGlobalShortcuts([bind('mod+f', run)]))

    press(at('panel'), { key: 'f', code: 'KeyF', metaKey: true })

    expect(run).not.toHaveBeenCalled()
  })

  it('keeps a bare key out of the editor but allows it from the page', () => {
    const run = vi.fn()
    renderHook(() => useGlobalShortcuts([bind('shift+/', run)]))

    press(at('para'), { key: '?', code: 'Slash', shiftKey: true })
    expect(run).not.toHaveBeenCalled()

    press(at('button'), { key: '?', code: 'Slash', shiftKey: true })
    expect(run).toHaveBeenCalledOnce()
  })

  it('falls through a binding whose `when` is false', () => {
    // Not swallowed: the next claimant on the same chord has to get a look.
    const gated = vi.fn()
    const fallback = vi.fn()
    renderHook(() =>
      useGlobalShortcuts([
        bind('mod+enter', gated, () => false),
        bind('mod+enter', fallback),
      ]),
    )

    press(at('button'), { key: 'Enter', code: 'Enter', metaKey: true })

    expect(gated).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('runs only the first match, so one key is never two commands', () => {
    const first = vi.fn()
    const second = vi.fn()
    renderHook(() =>
      useGlobalShortcuts([bind('mod+k', first), bind('mod+k', second)]),
    )

    press(at('button'), { key: 'k', code: 'KeyK', metaKey: true })

    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
  })

  it('does not resubscribe when the caller rebuilds the list', () => {
    // The whole point of the ref: handlers close over state, so the array is a
    // fresh one every render and resubscribing would be a listener per keypress.
    const add = vi.spyOn(window, 'addEventListener')
    const { rerender } = renderHook(() =>
      useGlobalShortcuts([bind('mod+s', () => {})]),
    )

    const initial = add.mock.calls.filter(([type]) => type === 'keydown').length
    rerender()
    rerender()

    expect(
      add.mock.calls.filter(([type]) => type === 'keydown').length,
    ).toBe(initial)
  })

  it('sees the latest handler after a rerender', () => {
    const stale = vi.fn()
    const fresh = vi.fn()
    const { rerender } = renderHook(
      ({ run }: { run: () => void }) => useGlobalShortcuts([bind('mod+s', run)]),
      { initialProps: { run: stale } },
    )

    rerender({ run: fresh })
    press(at('button'), { key: 's', code: 'KeyS', metaKey: true })

    expect(stale).not.toHaveBeenCalled()
    expect(fresh).toHaveBeenCalledOnce()
  })

  it('unsubscribes on unmount', () => {
    const run = vi.fn()
    const { unmount } = renderHook(() => useGlobalShortcuts([bind('mod+s', run)]))

    unmount()
    press(at('button'), { key: 's', code: 'KeyS', metaKey: true })

    expect(run).not.toHaveBeenCalled()
  })
})
