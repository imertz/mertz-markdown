import type { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { toMarkdown } from '../markdown/export'
import { toAnnotatedHtml } from '../markdown/exportHtml'
import type { ThreadWithComments } from '../types'
import { makeComment, makeSelector } from './dbHarness'
import {
  createTestEditor,
  createTestEditorFromJSON,
  rangeOfText,
} from './editorHarness'

const thread = (
  id: string,
  exact: string,
  overrides: Partial<ThreadWithComments> = {},
): ThreadWithComments => {
  const now = Date.now()
  return {
    id,
    docId: 'doc-1',
    status: 'open',
    selector: makeSelector({ exact }),
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    orphanedAt: null,
    comments: [makeComment(id, 'doc-1', { body: `note about ${exact}` })],
    ...overrides,
  }
}

const anchor = (editor: Editor, needle: string, threadId: string) => {
  editor.commands.setTextSelection(rangeOfText(editor, needle))
  editor.commands.setComment(threadId)
}

describe('annotated HTML export', () => {
  it('carries the anchors, the numbers and the thread bodies', async () => {
    const editor = createTestEditor('alpha bravo charlie')
    anchor(editor, 'bravo', 't1')

    const html = await toAnnotatedHtml(editor, {
      title: 'Notes',
      threads: [thread('t1', 'bravo')],
    })

    expect(html).toContain('<title>Notes</title>')
    expect(html).toContain('data-comment-thread="t1"')
    expect(html).toContain('id="anchor-1"')
    expect(html).toContain('href="#comment-1"')
    expect(html).toContain('id="comment-1"')
    expect(html).toContain('note about bravo')
    expect(html).toContain('Comments (1)')
  })

  it('numbers threads in document order, not the order it was given them', async () => {
    const editor = createTestEditor('alpha bravo charlie')
    anchor(editor, 'charlie', 'late')
    anchor(editor, 'alpha', 'early')

    const html = await toAnnotatedHtml(editor, {
      title: 'Notes',
      threads: [thread('late', 'charlie'), thread('early', 'alpha')],
    })

    // "alpha" is first in the text, so its thread is footnote 1.
    expect(html.indexOf('note about alpha')).toBeLessThan(
      html.indexOf('note about charlie'),
    )
    const first = html.slice(0, html.indexOf('data-comment-thread="late"'))
    expect(first).toContain('data-comment-thread="early"')
  })

  it('includes an orphaned thread without pretending it has an anchor', async () => {
    const editor = createTestEditor('alpha bravo charlie')

    const html = await toAnnotatedHtml(editor, {
      title: 'Notes',
      threads: [
        thread('t-orphan', 'deleted words', {
          status: 'orphaned',
          orphanedAt: Date.now(),
        }),
      ],
    })

    expect(html).toContain('note about deleted words')
    expect(html).toContain('anchor deleted')
    // No back-link, because there is nothing in the body to go back to.
    expect(html).not.toContain('href="#anchor-1"')
  })

  it('marks a resolved thread as resolved', async () => {
    const editor = createTestEditor('alpha bravo charlie')
    anchor(editor, 'bravo', 't1')

    const html = await toAnnotatedHtml(editor, {
      title: 'Notes',
      threads: [
        thread('t1', 'bravo', { status: 'resolved', resolvedAt: Date.now() }),
      ],
    })

    expect(html).toContain('resolved')
  })

  it('escapes markup in the title, the quotes and the comment bodies', async () => {
    // Every one of these is arbitrary user text landing in a file someone else
    // will open in a browser.
    const editor = createTestEditor('comparing a < b')
    anchor(editor, 'a < b', 't1')

    const html = await toAnnotatedHtml(editor, {
      title: '<img onerror=x>',
      threads: [
        thread('t1', '<b>quoted</b>', {
          comments: [
            makeComment('t1', 'doc-1', { body: '<script>alert(1)</script>' }),
          ],
        }),
      ],
    })

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img onerror')
    expect(html).not.toContain('<b>quoted</b>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<title>&lt;img onerror=x&gt;</title>')
    // …and the document's own literal `<`, inside the anchor span.
    expect(html).toContain('>a &lt; b</span>')
  })

  it('omits the annex entirely when there is nothing to say', async () => {
    const editor = createTestEditor('alpha bravo charlie')

    const html = await toAnnotatedHtml(editor, { title: 'Notes', threads: [] })
    expect(html).not.toContain('class="annex"')
    expect(html).toContain('alpha bravo charlie')
  })

  it('leaves the markdown export exactly as clean as it was', async () => {
    // The invariant this whole feature exists to avoid breaking, re-asserted
    // right next to the code that could break it.
    const editor = createTestEditor('alpha bravo charlie')
    anchor(editor, 'bravo', 't1')

    await toAnnotatedHtml(editor, {
      title: 'Notes',
      threads: [thread('t1', 'bravo')],
    })

    const markdown = toMarkdown(editor)
    expect(markdown).not.toContain('comment')
    expect(markdown).not.toContain('t1')
    expect(markdown).not.toContain('span')
    expect(markdown.trim()).toBe('alpha bravo charlie')
  })

  it('embeds browser-local images and strips their internal id', async () => {
    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                assetId: 'asset-1',
                src: 'images/asset-1.png',
                alt: 'Diagram',
              },
            },
          ],
        },
      ],
    })

    const html = await toAnnotatedHtml(editor, {
      title: 'Images',
      threads: [],
      resolveAsset: async id =>
        id === 'asset-1'
          ? new Blob(['png bytes'], { type: 'image/png' })
          : undefined,
    })

    expect(html).toContain('src="data:image/png;base64,')
    expect(html).not.toContain('data-local-asset-id')
  })

  it('preserves app-only image dimensions in annotated HTML', async () => {
    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                src: 'https://example.com/chart.png',
                alt: 'Chart',
                width: 320,
                height: 180,
              },
            },
          ],
        },
      ],
    })

    const html = await toAnnotatedHtml(editor, {
      title: 'Images',
      threads: [],
    })

    expect(html).toContain('width="320"')
    expect(html).toContain('height="180"')
  })
})
