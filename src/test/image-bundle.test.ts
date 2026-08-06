import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { putAssets } from '../db/assets'
import { putDocument } from '../db/documents'
import { assetMarkdownPath } from '../images/files'
import {
  buildDocumentExport,
  readDocumentBundle,
  unzipBundleWithLimits,
} from '../markdown/bundle'
import { createTestEditor, createTestEditorFromJSON } from './editorHarness'
import { makeAsset, makeDocument, resetDatabase } from './dbHarness'
import {
  OPTIMIZED_IMAGE_BYTES,
  stubImageOptimizer,
} from './imageOptimizeHarness'

beforeEach(async () => {
  stubImageOptimizer()
  await resetDatabase()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('portable image bundles', () => {
  it('exports clean Markdown and the exact referenced image bytes', async () => {
    const document_ = makeDocument({ title: 'Release plan' })
    const asset = makeAsset(document_.id)
    const path = assetMarkdownPath(asset)
    await Promise.all([putDocument(document_), putAssets([asset])])

    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: { assetId: asset.id, src: path, alt: 'Diagram' },
            },
          ],
        },
      ],
    })

    const exported = await buildDocumentExport(
      editor,
      document_.id,
      document_.title,
    )
    const entries = unzipSync(
      new Uint8Array(await exported.blob.arrayBuffer()),
    )

    expect(exported.filename).toBe('Release plan.zip')
    expect(strFromU8(entries['Release plan.md']!)).toBe(
      `![Diagram](${path})\n`,
    )
    expect(strFromU8(entries[path]!)).toBe('image bytes')
  })

  it('re-imports a bundle with fresh local ids and equivalent Markdown', async () => {
    const sourceDoc = makeDocument({ title: 'Pictures' })
    const sourceAsset = makeAsset(sourceDoc.id)
    const path = assetMarkdownPath(sourceAsset)
    await Promise.all([putDocument(sourceDoc), putAssets([sourceAsset])])
    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: { assetId: sourceAsset.id, src: path, alt: 'Diagram' },
            },
          ],
        },
      ],
    })
    const exported = await buildDocumentExport(editor, sourceDoc.id, 'Pictures')
    const imported = await readDocumentBundle(
      new File([exported.blob], exported.filename, { type: 'application/zip' }),
      'new-doc',
    )

    expect(imported.title).toBe('Pictures')
    expect(imported.assets).toHaveLength(1)
    expect(imported.assets[0]?.id).not.toBe(sourceAsset.id)
    expect(imported.assets[0]?.docId).toBe('new-doc')
    expect(await imported.assets[0]?.blob.text()).toBe(OPTIMIZED_IMAGE_BYTES)
    expect(imported.assets[0]?.originalName).toBe(sourceAsset.storageName)
    expect(imported.markdown).toMatch(/^!\[Diagram]\(images\/.+\.webp\)\n$/)
  })

  it('leaves a remote-only document as a plain Markdown download', async () => {
    const editor = createTestEditor('![Remote](https://example.com/a.png)')
    const exported = await buildDocumentExport(editor, 'doc', 'Remote notes')

    expect(exported.bundled).toBe(false)
    expect(exported.filename).toBe('Remote notes.md')
    expect(await exported.blob.text()).toContain('https://example.com/a.png')
  })

  it('refuses to export a missing local blob', async () => {
    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                assetId: 'missing',
                src: 'images/missing.png',
                alt: 'Missing',
              },
            },
          ],
        },
      ],
    })

    await expect(buildDocumentExport(editor, 'doc', 'Broken')).rejects.toThrow(
      'missing from browser storage',
    )
  })

  it('rejects unsafe archive paths', async () => {
    const zipped = zipSync({
      'notes.md': strToU8('hello'),
      '../outside.png': strToU8('bad'),
    })
    const file = new File([zipped.buffer as ArrayBuffer], 'unsafe.zip', {
      type: 'application/zip',
    })

    await expect(readDocumentBundle(file, 'doc')).rejects.toThrow('unsafe path')
  })

  it('accepts ordinary explicit directory entries', async () => {
    const zipped = zipSync({
      'notes.md': strToU8('![Diagram](images/diagram.png)'),
      'images/': new Uint8Array(),
      'images/diagram.png': strToU8('image bytes'),
    })
    const file = new File([zipped.buffer as ArrayBuffer], 'portable.zip', {
      type: 'application/zip',
    })

    const imported = await readDocumentBundle(file, 'doc')

    expect(imported.assets).toHaveLength(1)
    expect(await imported.assets[0]?.blob.text()).toBe(OPTIMIZED_IMAGE_BYTES)
    expect(imported.markdown).toMatch(/^!\[Diagram]\(images\/.+\.webp\)\n$/)
  })

  it('preserves animated GIF assets and paths', async () => {
    const zipped = zipSync({
      'notes.md': strToU8('![Animation](images/animation.gif)'),
      'images/animation.gif': strToU8('animated gif bytes'),
    })
    const file = new File([zipped.buffer as ArrayBuffer], 'animated.zip', {
      type: 'application/zip',
    })

    const imported = await readDocumentBundle(file, 'doc')

    expect(imported.assets[0]?.mimeType).toBe('image/gif')
    expect(await imported.assets[0]?.blob.text()).toBe('animated gif bytes')
    expect(imported.markdown).toMatch(/^!\[Animation]\(images\/.+\.gif\)\n$/)
  })

  it('rejects a bundle whose Markdown references a missing image', async () => {
    const zipped = zipSync({
      'notes.md': strToU8('![Missing](images/missing.png)'),
    })
    const file = new File([zipped.buffer as ArrayBuffer], 'missing.zip', {
      type: 'application/zip',
    })

    await expect(readDocumentBundle(file, 'doc')).rejects.toThrow(
      'missing images/missing.png',
    )
  })

  it('stops streaming when actual inflation exceeds the total cap', async () => {
    const zipped = zipSync({
      'notes.md': strToU8('x'.repeat(16 * 1024)),
    })
    // Under-report the local-header size so the check must observe emitted
    // bytes rather than trusting attacker-controlled ZIP metadata.
    const disguised = zipped.slice()
    new DataView(
      disguised.buffer,
      disguised.byteOffset,
      disguised.byteLength,
    ).setUint32(22, 1, true)
    const file = new File([disguised], 'bomb.zip', {
      type: 'application/zip',
    })

    await expect(
      unzipBundleWithLimits(file, {
        inputBytes: 1024 * 1024,
        inflatedBytes: 1024,
        entries: 10,
      }),
    ).rejects.toThrow('safe size limit')
  })

  it('rejects excessive entry counts before extracting their contents', async () => {
    const zipped = zipSync({
      'notes.md': strToU8('hello'),
      'one.txt': strToU8('one'),
      'two.txt': strToU8('two'),
    })

    await expect(
      unzipBundleWithLimits(new File([zipped], 'many.zip'), {
        inputBytes: 1024 * 1024,
        inflatedBytes: 1024,
        entries: 2,
      }),
    ).rejects.toThrow('too many files')
  })
})
