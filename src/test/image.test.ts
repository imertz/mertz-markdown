import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDocumentAsset, listDocumentAssets } from '../db/assets'
import { putDocument } from '../db/documents'
import { insertImageFiles } from '../images/insert'
import { toMarkdown } from '../markdown/export'
import { createTestEditor, createTestEditorFromJSON } from './editorHarness'
import { makeDocument, resetDatabase } from './dbHarness'
import { stubImageOptimizer } from './imageOptimizeHarness'

beforeEach(async () => {
  stubImageOptimizer()
  await resetDatabase()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('image Markdown', () => {
  it('round-trips ordinary URL images as standard syntax', () => {
    const editor = createTestEditor('Before ![A chart](https://example.com/chart.png) after')
    const images: string[] = []
    editor.state.doc.descendants(node => {
      if (node.type.name === 'image') images.push(node.attrs.src)
    })

    expect(images).toEqual(['https://example.com/chart.png'])
    expect(toMarkdown(editor)).toContain(
      '![A chart](https://example.com/chart.png)',
    )
  })

  it('round-trips an image title used as its caption', () => {
    const editor = createTestEditor(
      '![A chart](https://example.com/chart.png "Quarterly results")',
    )
    let title = ''
    editor.state.doc.descendants(node => {
      if (node.type.name === 'image') title = node.attrs.title
    })

    expect(title).toBe('Quarterly results')
    expect(toMarkdown(editor)).toBe(
      '![A chart](https://example.com/chart.png "Quarterly results")\n',
    )
  })

  it('keeps the local asset id out of Markdown', () => {
    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                assetId: 'secret-local-id',
                src: 'images/diagram.png',
                alt: 'Diagram',
              },
            },
          ],
        },
      ],
    })

    expect(toMarkdown(editor)).toBe('![Diagram](images/diagram.png)\n')
    expect(toMarkdown(editor)).not.toContain('secret-local-id')
  })

  it('keeps display dimensions in JSON but out of Markdown', () => {
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

    let dimensions: { width: number; height: number } | null = null
    editor.state.doc.descendants(node => {
      if (node.type.name === 'image') {
        dimensions = { width: node.attrs.width, height: node.attrs.height }
      }
    })
    expect(dimensions).toMatchObject({
      width: 320,
      height: 180,
    })
    expect(toMarkdown(editor)).toBe(
      '![Chart](https://example.com/chart.png)\n',
    )
  })

  it('keeps image-leading paragraphs and standalone images block-spaced', () => {
    const standalone = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: { src: 'https://example.com/standalone.png', alt: '' },
            },
          ],
        },
      ],
    })
    const inline = createTestEditor(
      'Before ![chart](https://example.com/inline.png) after',
    )
    const captioned = createTestEditor(
      '![chart](https://example.com/captioned.png)\nThis is the caption.',
    )
    const titled = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                src: 'https://example.com/titled.png',
                alt: 'Titled',
                title: 'A visible caption',
              },
            },
          ],
        },
      ],
    })

    expect(
      standalone.view.dom.querySelector(
        '.editor-image-resize--standalone',
      ),
    ).not.toBeNull()
    expect(
      inline.view.dom.querySelector('.editor-image-resize--standalone'),
    ).toBeNull()
    expect(
      captioned.view.dom.querySelector('.editor-image-resize--standalone'),
    ).not.toBeNull()
    expect(
      titled.view.dom.querySelector('.editor-image-resize--standalone'),
    ).not.toBeNull()
    expect(
      titled.view.dom.querySelector('.editor-image__caption')?.textContent,
    ).toBe('A visible caption')

    standalone.destroy()
    inline.destroy()
    captioned.destroy()
    titled.destroy()
  })
})

describe('image insertion', () => {
  it('stores a blob before inserting its durable reference', async () => {
    const document_ = makeDocument()
    await putDocument(document_)
    const editor = createTestEditor('hello')
    const file = new File(['png bytes'], 'release-chart.png', {
      type: 'image/png',
    })

    await insertImageFiles({ editor, docId: document_.id, files: [file] })

    let assetId = ''
    let src = ''
    editor.state.doc.descendants(node => {
      if (node.type.name !== 'image') return
      assetId = node.attrs.assetId
      src = node.attrs.src
      expect(node.attrs.alt).toBe('release chart')
    })

    expect(assetId).not.toBe('')
    expect(src).toMatch(/^images\/.+\.webp$/)
    const asset = await getDocumentAsset(document_.id, assetId)
    expect(asset?.storageName).toBe(src.replace('images/', ''))
    expect(asset?.mimeType).toBe('image/webp')
    expect(asset?.originalName).toBe('release-chart.png')
    expect(toMarkdown(editor)).toContain(`![release chart](${src})`)
  })

  it('does not store or insert a partial batch when encoding fails', async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    const encoding = stubImageOptimizer()
    encoding.toBlob
      .mockImplementationOnce((callback, type) => {
        callback(new Blob(['first webp'], { type }))
      })
      .mockImplementationOnce(callback => callback(null))
    const document_ = makeDocument()
    await putDocument(document_)
    const editor = createTestEditor('hello')

    await expect(
      insertImageFiles({
        editor,
        docId: document_.id,
        files: [
          new File(['first'], 'first.png', { type: 'image/png' }),
          new File(['second'], 'second.png', { type: 'image/png' }),
        ],
      }),
    ).rejects.toThrow('could not encode the imported image as WebP')

    expect(await listDocumentAssets(document_.id)).toEqual([])
    expect(toMarkdown(editor)).toBe('hello\n')
  })
})
