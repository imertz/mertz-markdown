import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDocumentAsset } from '../db/assets'
import { putDocument } from '../db/documents'
import { insertImageFiles } from '../images/insert'
import { toMarkdown } from '../markdown/export'
import { createTestEditor, createTestEditorFromJSON } from './editorHarness'
import { makeDocument, resetDatabase } from './dbHarness'

beforeEach(async () => {
  vi.stubGlobal('createImageBitmap', undefined)
  await resetDatabase()
})
afterEach(() => vi.unstubAllGlobals())

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
    expect(src).toMatch(/^images\/.+\.png$/)
    expect((await getDocumentAsset(document_.id, assetId))?.storageName).toBe(
      src.replace('images/', ''),
    )
    expect(toMarkdown(editor)).toContain(`![release chart](${src})`)
  })
})
