import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAsset, listDocumentAssets, putAssets } from '../db/assets'
import { putDocument } from '../db/documents'
import {
  canvasToWebp,
  localizeRemoteImage,
  replaceImageWithCrop,
} from '../images/transform'
import { assetMarkdownPath } from '../images/files'
import { makeAsset, makeDocument, resetDatabase } from './dbHarness'
import { createTestEditorFromJSON } from './editorHarness'

beforeEach(async () => {
  vi.stubGlobal('createImageBitmap', undefined)
  await resetDatabase()
})

afterEach(() => vi.unstubAllGlobals())

function webpCanvas(width = 800, height = 400): HTMLCanvasElement {
  return {
    width,
    height,
    toBlob: (callback: BlobCallback) =>
      callback(new Blob(['cropped bytes'], { type: 'image/webp' })),
  } as unknown as HTMLCanvasElement
}

describe('image crop assets', () => {
  it('requests WebP encoding at the selected quality', async () => {
    const toBlob = vi.fn((callback: BlobCallback) =>
      callback(new Blob(['webp'], { type: 'image/webp' })),
    )
    const canvas = { toBlob } as unknown as HTMLCanvasElement

    await expect(canvasToWebp(canvas)).resolves.toBeInstanceOf(Blob)
    expect(toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/webp',
      0.92,
    )
  })

  it('stores a new crop, preserves the old asset, and updates display ratio', async () => {
    const document_ = makeDocument()
    const original = makeAsset(document_.id)
    const src = assetMarkdownPath(original)
    await Promise.all([putDocument(document_), putAssets([original])])
    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                assetId: original.id,
                src,
                alt: 'Diagram',
                width: 320,
                height: 320,
              },
            },
          ],
        },
      ],
    })
    let position = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') position = pos
    })

    await replaceImageWithCrop(
      editor,
      document_.id,
      {
        position,
        expectedSrc: src,
        expectedAssetId: original.id,
      },
      webpCanvas(),
      320,
    )

    const image = editor.state.doc.nodeAt(position)
    expect(image?.attrs.assetId).not.toBe(original.id)
    expect(image?.attrs.src).toMatch(/^images\/.+\.webp$/)
    expect(image?.attrs.width).toBe(320)
    expect(image?.attrs.height).toBe(160)
    expect(await getAsset(original.id)).toBeDefined()
    expect(await listDocumentAssets(document_.id)).toHaveLength(2)
  })

  it('does not replace a node that changed while a crop was being encoded', async () => {
    const document_ = makeDocument()
    const original = makeAsset(document_.id)
    const src = assetMarkdownPath(original)
    await Promise.all([putDocument(document_), putAssets([original])])
    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: { assetId: original.id, src, alt: '' },
            },
          ],
        },
      ],
    })
    let position = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') position = pos
    })

    await expect(
      replaceImageWithCrop(
        editor,
        document_.id,
        {
          position,
          expectedSrc: 'images/not-the-current-image.png',
          expectedAssetId: original.id,
        },
        webpCanvas(),
        320,
      ),
    ).rejects.toThrow('selected image changed')

    expect(await listDocumentAssets(document_.id)).toHaveLength(1)
  })
})

describe('remote image localization', () => {
  it('replaces the selected URL with a durable local asset', async () => {
    const document_ = makeDocument()
    await putDocument(document_)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          blob: async () => new Blob(['png bytes'], { type: 'image/png' }),
        }) as Response,
      ),
    )
    const source = 'https://cdn.example.com/diagram.png'
    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: { assetId: null, src: source, alt: 'Diagram' },
            },
          ],
        },
      ],
    })
    let position = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') position = pos
    })

    await localizeRemoteImage(editor, document_.id, {
      position,
      expectedSrc: source,
      expectedAssetId: null,
    })

    const image = editor.state.doc.nodeAt(position)
    expect(image?.attrs.assetId).toEqual(expect.any(String))
    expect(image?.attrs.src).toMatch(/^images\/.+\.png$/)
    expect(await listDocumentAssets(document_.id)).toHaveLength(1)
  })
})
