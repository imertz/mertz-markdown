import type { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import type { ThreadWithComments } from '../types'
import { makeComment, makeSelector } from './dbHarness'
import { createTestEditor, rangeOfText } from './editorHarness'
import { documentText, elements, exportDocx } from './docxHarness'

const thread = (
  id: string,
  exact: string,
  overrides: Partial<ThreadWithComments> = {},
): ThreadWithComments => {
  const now = Date.UTC(2026, 0, 2, 3, 4, 5)
  return {
    id,
    docId: 'doc-1',
    status: 'open',
    selector: makeSelector({ exact }),
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    orphanedAt: null,
    comments: [
      makeComment(id, 'doc-1', { body: `note about ${exact}`, createdAt: now }),
    ],
    ...overrides,
  }
}

const anchor = (editor: Editor, needle: string, threadId: string) => {
  editor.commands.setTextSelection(rangeOfText(editor, needle))
  editor.commands.setComment(threadId)
}

/** `[startIds, endIds]` in the order the body declares them. */
const ranges = (body: string): [number[], number[]] => [
  [...body.matchAll(/<w:commentRangeStart w:id="(\d+)"\/>/g)].map(m => Number(m[1])),
  [...body.matchAll(/<w:commentRangeEnd w:id="(\d+)"\/>/g)].map(m => Number(m[1])),
]

describe('docx comments', () => {
  it('anchors a thread and writes its body into the comments part', async () => {
    const editor = createTestEditor('alpha bravo charlie')
    anchor(editor, 'bravo', 'thread-1')

    const exported = await exportDocx(editor, {
      threads: [thread('thread-1', 'bravo')],
    })
    const body = exported.text('word/document.xml')

    expect(ranges(body)).toEqual([[0], [0]])
    expect(body).toContain('<w:commentReference w:id="0"/>')
    expect(exported.text('word/comments.xml')).toContain('note about bravo')
    expect(exported.annotated).toBe(true)
  })

  it('declares the comments part in the content types and relationships', async () => {
    const editor = createTestEditor('alpha bravo')
    anchor(editor, 'bravo', 'thread-1')

    const exported = await exportDocx(editor, {
      threads: [thread('thread-1', 'bravo')],
    })

    expect(Object.keys(exported.parts)).toContain('word/comments.xml')
    expect(exported.text('[Content_Types].xml')).toContain(
      'wordprocessingml.comments+xml',
    )
    expect(exported.text('word/_rels/document.xml.rels')).toContain(
      'Target="comments.xml"',
    )
  })

  it('collapses a thread split across text nodes into one range', async () => {
    // Applying a mark splits the text node, and applying a second overlapping
    // one splits it again. Without the open/close tracking each fragment would
    // open and close its own range, and Word would draw three separate marks.
    const editor = createTestEditor('one two three four five')
    anchor(editor, 'two three four', 'thread-1')
    anchor(editor, 'three', 'thread-2')

    const exported = await exportDocx(editor, {
      threads: [thread('thread-1', 'two three four'), thread('thread-2', 'three')],
    })
    const [starts, ends] = ranges(exported.text('word/document.xml'))

    expect(starts.filter(id => id === 0)).toHaveLength(1)
    expect(ends.filter(id => id === 0)).toHaveLength(1)
    expect(starts.filter(id => id === 1)).toHaveLength(1)
  })

  it('numbers threads in document order, not the order they were given', async () => {
    const editor = createTestEditor('alpha bravo charlie')
    anchor(editor, 'charlie', 'later')
    anchor(editor, 'alpha', 'earlier')

    const exported = await exportDocx(editor, {
      threads: [thread('later', 'charlie'), thread('earlier', 'alpha')],
    })
    const [starts] = ranges(exported.text('word/document.xml'))

    expect(starts).toEqual([0, 1])
    // Id 0 is the one that appears first in the text, whichever was passed first.
    expect(exported.text('word/comments.xml')).toMatch(
      /w:id="0"[\s\S]*note about alpha[\s\S]*w:id="1"[\s\S]*note about charlie/,
    )
  })

  it('pairs every range with a comment that exists', async () => {
    const editor = createTestEditor('alpha bravo charlie delta')
    anchor(editor, 'alpha', 'a')
    anchor(editor, 'charlie', 'b')

    const exported = await exportDocx(editor, {
      threads: [thread('a', 'alpha'), thread('b', 'charlie')],
    })
    const [starts, ends] = ranges(exported.text('word/document.xml'))
    const declared = [
      ...exported.text('word/comments.xml').matchAll(/<w:comment w:id="(\d+)"/g),
    ].map(match => Number(match[1]))

    expect(starts.sort()).toEqual(ends.sort())
    for (const id of starts) expect(declared).toContain(id)
  })

  it('says so when a thread is resolved', async () => {
    const editor = createTestEditor('alpha bravo')
    anchor(editor, 'bravo', 'thread-1')

    const exported = await exportDocx(editor, {
      threads: [
        thread('thread-1', 'bravo', { status: 'resolved', resolvedAt: 1 }),
      ],
    })

    expect(exported.text('word/comments.xml')).toContain('Resolved')
  })

  it('keeps replies and their authors inside the one comment', async () => {
    const editor = createTestEditor('alpha bravo')
    anchor(editor, 'bravo', 'thread-1')

    const base = thread('thread-1', 'bravo')
    const exported = await exportDocx(editor, {
      threads: [
        {
          ...base,
          comments: [
            ...base.comments,
            makeComment('thread-1', 'doc-1', {
              body: 'and a reply',
              author: 'Alex Rivera',
            }),
          ],
        },
      ],
    })
    const comments = exported.text('word/comments.xml')

    expect(elements(comments, 'w:comment')).toHaveLength(1)
    expect(comments).toContain('and a reply')
    expect(comments).toContain('Alex Rivera')
    // The w:comment's own author is the thread's first commenter.
    expect(comments).toContain('w:author="You"')
    expect(comments).toContain('w:initials="Y"')
  })

  it('gathers threads whose anchor was deleted into a trailing section', async () => {
    const editor = createTestEditor('alpha bravo')
    anchor(editor, 'bravo', 'anchored')

    const exported = await exportDocx(editor, {
      threads: [
        thread('anchored', 'bravo'),
        thread('gone', 'deleted words', { status: 'orphaned', orphanedAt: 1 }),
      ],
    })
    const body = exported.text('word/document.xml')

    expect(documentText(body)).toContain('Comments without anchors')
    expect(documentText(body)).toContain('deleted words')
    // Still a real Word comment, so it is reviewable rather than just printed.
    expect(ranges(body)[0]).toEqual([0, 1])
    expect(exported.text('word/comments.xml')).toContain(
      'The commented text was deleted',
    )
  })

  it('ignores a comment mark whose thread this document does not own', async () => {
    // A mark can arrive by paste; CommentSanitizer strips those on the way in,
    // so anything left here must not become a dangling range.
    const editor = createTestEditor('alpha bravo')
    anchor(editor, 'bravo', 'foreign')

    const exported = await exportDocx(editor, { threads: [] })
    const body = exported.text('word/document.xml')

    expect(ranges(body)).toEqual([[], []])
    expect(elements(exported.text('word/comments.xml'), 'w:comment')).toEqual([])
    expect(documentText(body)).toBe('alpha bravo')
    expect(exported.annotated).toBe(false)
  })
})

describe('the clean docx export', () => {
  it('carries no trace of a comment', async () => {
    const editor = createTestEditor('alpha bravo charlie')
    anchor(editor, 'bravo', 'thread-1')
    anchor(editor, 'charlie', 'thread-2')

    // No `threads`, so this is the clean variant even though the document is
    // full of anchors — the same shape as the markdown path's guarantee.
    const exported = await exportDocx(editor)

    for (const [path, bytes] of Object.entries(exported.parts)) {
      const text = new TextDecoder().decode(bytes)
      expect(text, path).not.toContain('commentRange')
      expect(text, path).not.toContain('commentReference')
      expect(text, path).not.toContain('thread-1')
      expect(text, path).not.toContain('thread-2')
    }

    expect(Object.keys(exported.parts)).not.toContain('word/comments.xml')
    expect(documentText(exported.text('word/document.xml'))).toBe(
      'alpha bravo charlie',
    )
    expect(exported.filename).toBe('Notes.docx')
  })

  it('names the annotated file differently so the two never overwrite', async () => {
    const editor = createTestEditor('alpha')
    const exported = await exportDocx(editor, { threads: [] })

    expect(exported.filename).toBe('Notes-comments.docx')
  })
})
