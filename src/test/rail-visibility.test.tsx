import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COMMENT_MARK_NAME,
  collectAnchoredThreadIds,
} from '../editor/extensions/comment'
import { useRailHidden } from '../hooks/useRailHidden'
import { createTestEditor, rangeOfText } from './editorHarness'

const RAIL_KEY = 'mertz-md:rail-hidden'

beforeEach(() => {
  localStorage.clear()
})

afterEach(cleanup)

describe('useRailHidden', () => {
  it('starts visible', () => {
    const { result } = renderHook(() => useRailHidden())

    expect(result.current.hidden).toBe(false)
  })

  it('remembers a hidden rail across mounts', () => {
    const first = renderHook(() => useRailHidden())
    act(() => first.result.current.toggle())
    expect(first.result.current.hidden).toBe(true)
    expect(localStorage.getItem(RAIL_KEY)).toBe('true')
    first.unmount()

    // A fresh mount is what a reload looks like.
    const second = renderHook(() => useRailHidden())
    expect(second.result.current.hidden).toBe(true)
  })

  it('show() forces the rail back and persists it', () => {
    const { result } = renderHook(() => useRailHidden())

    act(() => result.current.toggle())
    expect(result.current.hidden).toBe(true)

    act(() => result.current.show())
    expect(result.current.hidden).toBe(false)
    expect(localStorage.getItem(RAIL_KEY)).toBe('false')
  })

  it('show() is a no-op when the rail is already visible', () => {
    const { result } = renderHook(() => useRailHidden())

    act(() => result.current.show())

    expect(result.current.hidden).toBe(false)
    // Nothing to persist, so nothing was written.
    expect(localStorage.getItem(RAIL_KEY)).toBeNull()
  })
})

describe('hiding the rail and the document', () => {
  it('leaves comment anchors untouched', () => {
    // The rail is a view of the threads, not their storage. Unmounting it must
    // not take the marks with it — this is what makes hiding safe rather than
    // destructive.
    const editor = createTestEditor('The quick brown fox jumps.\n')
    editor.commands.setTextSelection(rangeOfText(editor, 'brown fox'))
    editor.commands.setComment('thread-1')

    expect(collectAnchoredThreadIds(editor.state.doc)).toEqual(
      new Set(['thread-1']),
    )

    // Nothing in the visibility hook touches the editor at all.
    const { result, unmount } = renderHook(() => useRailHidden())
    act(() => result.current.toggle())
    unmount()

    expect(editor.schema.marks[COMMENT_MARK_NAME]).toBeTruthy()
    expect(collectAnchoredThreadIds(editor.state.doc)).toEqual(
      new Set(['thread-1']),
    )

    editor.destroy()
  })
})
