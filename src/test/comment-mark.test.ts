import { describe, expect, it } from 'vitest'
import {
  COMMENT_MARK_NAME,
  collectAnchoredThreadIds,
  findMarkRanges,
} from '../editor/extensions/comment'
import { toMarkdown } from '../markdown/export'
import { createTestEditor, rangeOfText } from './editorHarness'

const comment = (editor: ReturnType<typeof createTestEditor>) => {
  const type = editor.schema.marks[COMMENT_MARK_NAME]
  if (!type) throw new Error('comment mark missing')
  return type
}

describe('comments never reach the markdown', () => {
  it('produces byte-identical output with and without overlapping comments', () => {
    const source = 'The **quick** brown fox jumps over the lazy dog.\n'

    const clean = createTestEditor(source)
    const expected = toMarkdown(clean)

    const annotated = createTestEditor(source)
    const first = rangeOfText(annotated, 'brown fox')
    annotated.commands.setTextSelection(first)
    annotated.commands.setComment('thread-1')

    // Deliberately overlapping: proves excludes:'' works and that two marks on
    // one text node still contribute nothing to the output.
    const second = rangeOfText(annotated, 'fox jumps')
    annotated.commands.setTextSelection(second)
    annotated.commands.setComment('thread-2')

    expect(collectAnchoredThreadIds(annotated.state.doc)).toEqual(
      new Set(['thread-1', 'thread-2']),
    )
    expect(toMarkdown(annotated)).toBe(expected)
    expect(toMarkdown(annotated)).not.toContain('data-comment-thread')
    expect(toMarkdown(annotated)).not.toMatch(/<[a-z][^>]*>/i)

    clean.destroy()
    annotated.destroy()
  })

  it('does not split a bold run when a comment boundary falls inside it', () => {
    // The one plausible way an invisible mark could still corrupt output is via
    // the serializer's close-and-reopen path for overlapping mark ranges.
    const editor = createTestEditor('A **quick brown** fox.\n')
    const before = toMarkdown(editor)
    expect(before).toContain('**quick brown**')

    editor.commands.setTextSelection(rangeOfText(editor, 'quick'))
    editor.commands.setComment('thread-inside-bold')

    const after = toMarkdown(editor)
    expect(after).toBe(before)
    expect(after).not.toContain('**quick** **brown**')
    editor.destroy()
  })

  it('keeps comments out of every GFM construct', () => {
    const source = [
      '# Heading',
      '',
      '- [ ] a task with ~~strike~~',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '> a quote with `code`',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
    ].join('\n')

    const clean = createTestEditor(source)
    const expected = toMarkdown(clean)

    const annotated = createTestEditor(source)
    for (const [index, needle] of ['Heading', 'a task', 'a quote'].entries()) {
      annotated.commands.setTextSelection(rangeOfText(annotated, needle))
      annotated.commands.setComment(`thread-${index}`)
    }

    expect(toMarkdown(annotated)).toBe(expected)
    clean.destroy()
    annotated.destroy()
  })
})

describe('anchor behaviour', () => {
  it('does not grow when text is typed at either edge', () => {
    const editor = createTestEditor('alpha bravo charlie\n')
    const range = rangeOfText(editor, 'bravo')
    editor.commands.setTextSelection(range)
    editor.commands.setComment('t1')

    const anchored = () =>
      findMarkRanges(editor.state.doc, comment(editor), 't1')
        .map(hit => editor.state.doc.textBetween(hit.from, hit.to))
        .join('')

    expect(anchored()).toBe('bravo')

    // Type immediately after the anchor's end…
    editor.commands.setTextSelection({ from: range.to, to: range.to })
    editor.commands.insertContent('X')
    expect(anchored()).toBe('bravo')

    // …and immediately before its start.
    editor.commands.setTextSelection({ from: range.from, to: range.from })
    editor.commands.insertContent('Y')
    expect(anchored()).toBe('bravo')

    editor.destroy()
  })

  it('lets two threads overlap the same text', () => {
    const editor = createTestEditor('one two three four\n')
    editor.commands.setTextSelection(rangeOfText(editor, 'two three'))
    editor.commands.setComment('a')
    editor.commands.setTextSelection(rangeOfText(editor, 'three four'))
    editor.commands.setComment('b')

    expect(collectAnchoredThreadIds(editor.state.doc)).toEqual(
      new Set(['a', 'b']),
    )
    // "three" carries both marks at once.
    const overlap = rangeOfText(editor, 'three')
    const marksAt = editor.state.doc.resolve(overlap.from + 1).marks()
    expect(
      marksAt.filter(m => m.type.name === COMMENT_MARK_NAME).length,
    ).toBe(2)

    editor.destroy()
  })

  it('unsetComment removes one thread and leaves the overlapping one', () => {
    const editor = createTestEditor('one two three four\n')
    editor.commands.setTextSelection(rangeOfText(editor, 'two three'))
    editor.commands.setComment('a')
    editor.commands.setTextSelection(rangeOfText(editor, 'three four'))
    editor.commands.setComment('b')

    editor.commands.unsetComment('a')

    expect(collectAnchoredThreadIds(editor.state.doc)).toEqual(new Set(['b']))
    editor.destroy()
  })

  it('setCommentResolved updates attrs without touching the range', () => {
    const editor = createTestEditor('alpha bravo charlie\n')
    editor.commands.setTextSelection(rangeOfText(editor, 'bravo'))
    editor.commands.setComment('t1')

    editor.commands.setCommentResolved('t1', true)

    const hits = findMarkRanges(editor.state.doc, comment(editor), 't1')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.mark.attrs.resolved).toBe(true)
    expect(
      editor.state.doc.textBetween(hits[0]!.from, hits[0]!.to),
    ).toBe('bravo')
    editor.destroy()
  })
})
