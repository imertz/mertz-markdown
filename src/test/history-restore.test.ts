import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { buildExtensions } from '../editor/extensions'
import {
  COMMENT_MARK_NAME,
  findMarkRanges,
} from '../editor/extensions/comment'
import { toMarkdown } from '../markdown/export'
import { createTestEditor, rangeOfText } from './editorHarness'

/**
 * Restoring a version is `setContent`, deliberately.
 *
 * It writes nothing to the database directly: the transaction goes through the
 * ordinary pipeline, `emitUpdate` lets the normal autosave persist it via
 * toMarkdown, and — the point of these tests — it lands on the undo stack like
 * any other edit, so a restore chosen by mistake costs one Cmd-Z.
 */
describe('restoring a snapshot', () => {
  it('is a single undoable step', () => {
    const editor = createTestEditor('the current draft')
    const before = editor.state.doc.toJSON()

    const snapshot = createTestEditor('an older draft').getJSON()
    editor.commands.setContent(snapshot, { emitUpdate: true })
    expect(toMarkdown(editor)).toContain('an older draft')

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('brings back the comment anchors the version was carrying', () => {
    // A snapshot stores canonical ProseMirror JSON precisely so this works —
    // markdown could not carry the anchor, and the thread would come back
    // pointing at nothing.
    const source = createTestEditor('alpha bravo charlie')
    source.commands.setTextSelection(rangeOfText(source, 'bravo'))
    source.commands.setComment('thread-live')
    const snapshot = source.getJSON()

    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({
        // The thread still exists, so the sanitizer must leave it alone.
        getKnownThreadIds: () => new Set(['thread-live']),
      }),
      content: 'something else entirely',
    })

    editor.commands.setContent(snapshot, { emitUpdate: true })

    const anchors = findMarkRanges(
      editor.state.doc,
      editor.schema.marks[COMMENT_MARK_NAME],
      'thread-live',
    )
    expect(anchors).toHaveLength(1)
    expect(
      editor.state.doc.textBetween(anchors[0].from, anchors[0].to),
    ).toBe('bravo')
  })

  it('drops anchors whose thread has been deleted since', () => {
    const source = createTestEditor('alpha bravo charlie')
    source.commands.setTextSelection(rangeOfText(source, 'bravo'))
    source.commands.setComment('thread-gone')
    const snapshot = source.getJSON()

    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({
        // A different thread exists, so the known set is non-empty and the
        // sanitizer is live — this is it doing its job, not a loss.
        getKnownThreadIds: () => new Set(['thread-other']),
      }),
      content: 'something else entirely',
    })

    editor.commands.setContent(snapshot, { emitUpdate: true })

    expect(
      findMarkRanges(editor.state.doc, editor.schema.marks[COMMENT_MARK_NAME]),
    ).toEqual([])
    // The text itself is untouched; only the dangling anchor went.
    expect(toMarkdown(editor)).toContain('alpha bravo charlie')
  })

  it('leaves no trace of comments in the markdown a restore produces', () => {
    const source = createTestEditor('alpha bravo charlie')
    source.commands.setTextSelection(rangeOfText(source, 'bravo'))
    source.commands.setComment('thread-live')

    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({
        getKnownThreadIds: () => new Set(['thread-live']),
      }),
      content: '',
    })
    editor.commands.setContent(source.getJSON(), { emitUpdate: true })

    const markdown = toMarkdown(editor)
    expect(markdown).not.toContain('comment')
    expect(markdown).not.toContain('thread-live')
    expect(markdown.trim()).toBe('alpha bravo charlie')
  })
})
