import type { JSONContent } from '@tiptap/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { putAssets } from '../db/assets'
import { CONTENT_WIDTH_EMU, emuFromPixels } from '../docx/units'
import { assetMarkdownPath } from '../images/files'
import { createTestEditorFromJSON } from './editorHarness'
import { makeAsset, resetDatabase } from './dbHarness'
import { attribute, documentText, elements, exportDocx, FAKE_IMAGE_SIZE } from './docxHarness'

beforeEach(resetDatabase)

const docWithImage = (attrs: Record<string, unknown>): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'image', attrs }]}],
})

const mediaParts = (parts: Record<string, Uint8Array>): string[] =>
  Object.keys(parts).filter(path => path.startsWith('word/media/'))

describe('docx images', () => {
  it('embeds a local asset and points the body at it', async () => {
    const asset = makeAsset('doc-1')
    await putAssets([asset])

    const editor = createTestEditorFromJSON(
      docWithImage({
        assetId: asset.id,
        src: assetMarkdownPath(asset),
        alt: 'A diagram',
      }),
    )
    const exported = await exportDocx(editor)

    expect(mediaParts(exported.parts)).toEqual(['word/media/image1.png'])
    expect(exported.text('[Content_Types].xml')).toContain(
      '<Default Extension="png" ContentType="image/png"/>',
    )

    const body = exported.text('word/document.xml')
    const embed = attribute(body, 'a:blip', 'r:embed')
    expect(embed).toMatch(/^rId\d+$/)
    expect(exported.text('word/_rels/document.xml.rels')).toContain(
      `Id="${embed}"`,
    )
    expect(body).toContain('descr="A diagram"')
  })

  it('stores an asset used twice only once', async () => {
    const asset = makeAsset('doc-1')
    await putAssets([asset])
    const attrs = { assetId: asset.id, src: assetMarkdownPath(asset), alt: '' }

    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'image', attrs }] },
        { type: 'paragraph', content: [{ type: 'image', attrs }] },
      ],
    })
    const exported = await exportDocx(editor)

    expect(mediaParts(exported.parts)).toHaveLength(1)
    expect(elements(exported.text('word/document.xml'), 'w:drawing')).toHaveLength(2)
  })

  it('sizes an unsized image from its intrinsic dimensions', async () => {
    const asset = makeAsset('doc-1')
    await putAssets([asset])

    const editor = createTestEditorFromJSON(
      docWithImage({ assetId: asset.id, src: assetMarkdownPath(asset) }),
    )
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(attribute(body, 'wp:extent', 'cx')).toBe(
      String(emuFromPixels(FAKE_IMAGE_SIZE.width)),
    )
    expect(attribute(body, 'wp:extent', 'cy')).toBe(
      String(emuFromPixels(FAKE_IMAGE_SIZE.height)),
    )
  })

  it('derives the height from the aspect ratio when only a width is set', async () => {
    const asset = makeAsset('doc-1')
    await putAssets([asset])

    const editor = createTestEditorFromJSON(
      docWithImage({
        assetId: asset.id,
        src: assetMarkdownPath(asset),
        width: 200,
      }),
    )
    const body = (await exportDocx(editor)).text('word/document.xml')

    // 200 of an intrinsic 400×200 is half, so the height halves with it.
    expect(attribute(body, 'wp:extent', 'cx')).toBe(String(emuFromPixels(200)))
    expect(attribute(body, 'wp:extent', 'cy')).toBe(String(emuFromPixels(100)))
  })

  it('shrinks an oversized image to the text column', async () => {
    const asset = makeAsset('doc-1')
    await putAssets([asset])

    const editor = createTestEditorFromJSON(
      docWithImage({
        assetId: asset.id,
        src: assetMarkdownPath(asset),
        width: 4000,
        height: 2000,
      }),
    )
    const body = (await exportDocx(editor)).text('word/document.xml')

    // Word crops rather than scales an image wider than the column, so the
    // overflow would simply not print.
    expect(Number(attribute(body, 'wp:extent', 'cx'))).toBe(CONTENT_WIDTH_EMU)
    expect(Number(attribute(body, 'wp:extent', 'cy'))).toBe(
      Math.round(CONTENT_WIDTH_EMU / 2),
    )
  })

  it('links a remote image rather than fetching it', async () => {
    const editor = createTestEditorFromJSON(
      docWithImage({ src: 'https://example.com/photo.png', alt: 'Photo' }),
    )
    const exported = await exportDocx(editor)
    const body = exported.text('word/document.xml')

    expect(mediaParts(exported.parts)).toHaveLength(0)
    expect(documentText(body)).toBe('Photo')
    expect(exported.text('word/_rels/document.xml.rels')).toContain(
      'Target="https://example.com/photo.png"',
    )
  })

  it('writes an image caption as a Caption paragraph', async () => {
    const editor = createTestEditorFromJSON(
      docWithImage({
        src: 'https://example.com/photo.png',
        alt: 'Photo',
        caption: 'A field study',
      }),
    )
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(body).toContain('<w:pStyle w:val="Caption"/>')
    expect(documentText(body)).toContain('A field study')
  })

  it('captions the image rather than the text that shared its line', async () => {
    const asset = makeAsset('doc-1')
    await putAssets([asset])

    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                assetId: asset.id,
                src: assetMarkdownPath(asset),
                alt: 'Photo',
                caption: 'A field study',
              },
            },
            { type: 'text', text: 'The sentence that followed it.' },
          ],
        },
      ],
    })
    const body = (await exportDocx(editor)).text('word/document.xml')
    const paragraphs = elements(body, 'w:p')

    // Left inline, Word wraps the sentence around the picture and the caption
    // ends up under the text instead of under the image.
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[0]).toContain('<w:drawing>')
    expect(paragraphs[1]).toContain('<w:pStyle w:val="Caption"/>')
    expect(documentText(paragraphs[1]!)).toBe('A field study')
    expect(documentText(paragraphs[2]!)).toBe('The sentence that followed it.')
  })

  it('does not repeat the bullet when splitting a list item', async () => {
    const asset = makeAsset('doc-1')
    await putAssets([asset])

    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'An item ' },
                    {
                      type: 'image',
                      attrs: {
                        assetId: asset.id,
                        src: assetMarkdownPath(asset),
                        alt: 'Photo',
                        caption: 'A field study',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    const body = (await exportDocx(editor)).text('word/document.xml')
    const paragraphs = elements(body, 'w:p')

    expect(paragraphs).toHaveLength(3)
    expect(paragraphs.filter(xml => xml.includes('<w:numPr>'))).toHaveLength(1)
    expect(paragraphs[0]).toContain('<w:numPr>')
  })

  it('refuses to export when a referenced asset is gone', async () => {
    const editor = createTestEditorFromJSON(
      docWithImage({ assetId: 'missing', src: 'images/missing.png' }),
    )

    await expect(exportDocx(editor)).rejects.toThrow(
      'A referenced image is missing from browser storage',
    )
  })

  it('will not read another document’s asset', async () => {
    const asset = makeAsset('other-doc')
    await putAssets([asset])

    const editor = createTestEditorFromJSON(
      docWithImage({ assetId: asset.id, src: assetMarkdownPath(asset) }),
    )

    await expect(exportDocx(editor, { docId: 'doc-1' })).rejects.toThrow(
      'A referenced image is missing from browser storage',
    )
  })
})
