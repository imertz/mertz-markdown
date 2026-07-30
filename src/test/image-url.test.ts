import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listDocumentAssets } from '../db/assets'
import { putDocument } from '../db/documents'
import {
  fetchImageFile,
  insertImageUrl,
  normalizeImageUrl,
} from '../images/url'
import { toMarkdown } from '../markdown/export'
import { makeDocument, resetDatabase } from './dbHarness'
import { createTestEditor } from './editorHarness'
import { stubImageOptimizer } from './imageOptimizeHarness'

beforeEach(async () => {
  stubImageOptimizer()
  await resetDatabase()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('image URL validation', () => {
  it('normalizes hosts and accepts only credential-free HTTP URLs', () => {
    expect(normalizeImageUrl('example.com/picture.png')).toBe(
      'https://example.com/picture.png',
    )
    expect(normalizeImageUrl('http://example.com/a.jpg')).toBe(
      'http://example.com/a.jpg',
    )
    expect(normalizeImageUrl('javascript:alert(1)')).toBe('')
    expect(normalizeImageUrl('data:image/png;base64,abc')).toBe('')
    expect(normalizeImageUrl('https://user:secret@example.com/a.png')).toBe('')
  })

  it('inserts a remote URL without creating a local asset', async () => {
    const document_ = makeDocument()
    await putDocument(document_)
    const editor = createTestEditor('hello')

    await insertImageUrl({
      editor,
      docId: document_.id,
      url: 'example.com/picture.png',
      alt: 'A useful diagram',
      decorative: false,
      storeLocally: false,
      position: 1,
    })

    expect(toMarkdown(editor)).toContain(
      '![A useful diagram](https://example.com/picture.png)',
    )
    expect(await listDocumentAssets(document_.id)).toEqual([])
  })

  it('requires alt text unless the image is explicitly decorative', async () => {
    const editor = createTestEditor('hello')
    await expect(
      insertImageUrl({
        editor,
        docId: 'doc',
        url: 'https://example.com/a.png',
        alt: ' ',
        decorative: false,
        storeLocally: false,
        position: 1,
      }),
    ).rejects.toThrow('Describe the image')

    await insertImageUrl({
      editor,
      docId: 'doc',
      url: 'https://example.com/a.png',
      alt: 'ignored',
      decorative: true,
      storeLocally: false,
      position: 1,
    })
    expect(toMarkdown(editor)).toContain('![](https://example.com/a.png)')
  })

  it('downloads, validates, and stores a requested local copy', async () => {
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
    const editor = createTestEditor('hello')

    await insertImageUrl({
      editor,
      docId: document_.id,
      url: 'https://cdn.example.com/picture.png',
      alt: 'Offline diagram',
      decorative: false,
      storeLocally: true,
      position: 1,
    })

    const assets = await listDocumentAssets(document_.id)
    expect(assets).toHaveLength(1)
    expect(assets[0]?.mimeType).toBe('image/webp')
    expect(toMarkdown(editor)).toMatch(/!\[Offline diagram]\(images\/.+\.webp\)/)
  })

  it('leaves the document unchanged when CORS or networking blocks a copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('CORS'))))
    const editor = createTestEditor('hello')

    await expect(
      fetchImageFile('https://example.com/a.png'),
    ).rejects.toThrow('cross-origin')
    expect(toMarkdown(editor)).toBe('hello\n')
  })

  it('canonicalizes a downloaded type from its validated extension', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          blob: async () => new Blob(['gif bytes']),
        }) as Response,
      ),
    )

    const file = await fetchImageFile('https://example.com/animation.gif')
    expect(file.type).toBe('image/gif')
  })
})
