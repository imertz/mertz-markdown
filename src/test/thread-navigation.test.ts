import { describe, expect, it } from 'vitest'
import {
  COMMENT_MARK_NAME,
  collectThreadStarts,
  findMarkRanges,
  nextThreadAfter,
} from '../editor/extensions/comment'
import { createTestEditor, rangeOfText } from './editorHarness'

/**
 * Backs the status bar's comment chip, which walks the caret from one thread to
 * the next. The whole reason this logic is not a one-line `findMarkRanges` call
 * is the text-node split asserted in the first test below.
 */

const markType = (editor: ReturnType<typeof createTestEditor>) => {
  const type = editor.schema.marks[COMMENT_MARK_NAME]
  if (!type) throw new Error('comment mark missing')
  return type
}

const annotate = (
  editor: ReturnType<typeof createTestEditor>,
  needle: string,
  threadId: string,
) => {
  editor.commands.setTextSelection(rangeOfText(editor, needle))
  editor.commands.setComment(threadId)
}

describe('collectThreadStarts', () => {
  it('reports one start per thread even when its anchor spans text nodes', () => {
    // A comment laid across a bold run splits into three text nodes, each
    // carrying the mark. Without deduping, "next comment" would step three
    // times to cross a single thread.
    const editor = createTestEditor('Alpha **bold** omega.\n')
    annotate(editor, 'Alpha bold omega', 't1')

    const type = markType(editor)
    expect(
      findMarkRanges(editor.state.doc, type).length,
    ).toBeGreaterThan(1)

    const starts = collectThreadStarts(
      editor.state.doc,
      type,
      new Set(['t1']),
    )
    expect(starts).toHaveLength(1)
    expect(starts[0].threadId).toBe('t1')

    editor.destroy()
  })

  it('returns threads in document order, not insertion order', () => {
    const editor = createTestEditor('Alpha one. Bravo two. Charlie three.\n')
    annotate(editor, 'Charlie', 'last')
    annotate(editor, 'Alpha', 'first')
    annotate(editor, 'Bravo', 'middle')

    const starts = collectThreadStarts(
      editor.state.doc,
      markType(editor),
      new Set(['first', 'middle', 'last']),
    )

    expect(starts.map(start => start.threadId)).toEqual([
      'first',
      'middle',
      'last',
    ])

    editor.destroy()
  })

  it('ignores threads outside the requested set', () => {
    // Resolved anchors stay in the document; the chip counts open threads, so
    // navigation has to agree with the count.
    const editor = createTestEditor('Alpha one. Bravo two.\n')
    annotate(editor, 'Alpha', 'open-thread')
    annotate(editor, 'Bravo', 'resolved-thread')

    const starts = collectThreadStarts(
      editor.state.doc,
      markType(editor),
      new Set(['open-thread']),
    )

    expect(starts.map(start => start.threadId)).toEqual(['open-thread'])

    editor.destroy()
  })
})

describe('nextThreadAfter', () => {
  it('walks forward and wraps back to the first', () => {
    const editor = createTestEditor('Alpha one. Bravo two. Charlie three.\n')
    annotate(editor, 'Alpha', 't1')
    annotate(editor, 'Bravo', 't2')
    annotate(editor, 'Charlie', 't3')

    const type = markType(editor)
    const ids = new Set(['t1', 't2', 't3'])
    const step = (from: number) =>
      nextThreadAfter(editor.state.doc, type, ids, from)

    const first = step(0)
    expect(first?.threadId).toBe('t1')

    // Feeding each answer back in is what repeated clicks do.
    const second = step(first?.from ?? 0)
    expect(second?.threadId).toBe('t2')

    const third = step(second?.from ?? 0)
    expect(third?.threadId).toBe('t3')

    const wrapped = step(third?.from ?? 0)
    expect(wrapped?.threadId).toBe('t1')

    editor.destroy()
  })

  it('keeps returning the only thread rather than going dead', () => {
    const editor = createTestEditor('Alpha one. Bravo two.\n')
    annotate(editor, 'Alpha', 'only')

    const type = markType(editor)
    const ids = new Set(['only'])

    const landed = nextThreadAfter(editor.state.doc, type, ids, 0)
    expect(landed?.threadId).toBe('only')
    expect(
      nextThreadAfter(editor.state.doc, type, ids, landed?.from ?? 0)?.threadId,
    ).toBe('only')

    editor.destroy()
  })

  it('is null when the document has no matching thread', () => {
    const editor = createTestEditor('Alpha one.\n')

    expect(
      nextThreadAfter(editor.state.doc, markType(editor), new Set(['t1']), 0),
    ).toBeNull()

    editor.destroy()
  })
})
