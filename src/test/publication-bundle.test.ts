import { describe, expect, it } from 'vitest'
import { buildPublicationBundle, PublicationBuildError } from '../extensions/blog/bundle'
import { defaultArticleState } from '../extensions/blog/state'
import { makeAsset, makeDocument } from './dbHarness'

function publicationDocument() {
  const document = makeDocument({
    id: 'document-1',
    title: 'Request processing',
    markdown: '# Request processing\n\n![Architecture diagram](images/architecture.webp)\n',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Request processing' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                src: 'images/architecture.webp',
                assetId: 'asset-1',
                alt: 'Architecture diagram',
                title: 'Open full size',
                caption: 'Figure 1 — Request processing architecture',
                width: 640,
                height: 360,
                alignment: 'center',
              },
            },
          ],
        },
      ],
    },
  })
  const asset = makeAsset(document.id, {
    id: 'asset-1',
    storageName: 'architecture.webp',
    originalName: 'architecture.webp',
    mimeType: 'image/webp',
  })
  return { document, asset }
}

describe('PublicationBundleV1', () => {
  it('extracts a schema-independent bundle and all image presentation metadata', async () => {
    const { document, asset } = publicationDocument()
    const article = {
      ...defaultArticleState(document.id, 'mysolon'),
      draft: false,
      tags: [' architecture ', 'typescript', 'architecture'],
    }

    const built = await buildPublicationBundle(
      document,
      article,
      async (_documentId, assetId) => (assetId === asset.id ? asset : undefined),
    )

    expect(built.bundle).toMatchObject({
      protocol: 'mertz-publication/1',
      document: {
        id: document.id,
        title: document.title,
        markdown: document.markdown,
      },
      article: { draft: false, tags: ['architecture', 'typescript'] },
      images: [
        {
          assetId: 'asset-1',
          path: 'images/architecture.webp',
          mimeType: 'image/webp',
          alt: 'Architecture diagram',
          title: 'Open full size',
          caption: 'Figure 1 — Request processing architecture',
          width: 640,
          height: 360,
          alignment: 'center',
        },
      ],
    })
    expect(built.bundle.images[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(built.publicationHash).toMatch(/^[a-f0-9]{64}$/)
    expect(built.files.get(0)?.id).toBe(asset.id)
  })

  it('changes freshness for caption, dimensions, tags, and image bytes', async () => {
    const { document, asset } = publicationDocument()
    const article = defaultArticleState(document.id, 'mysolon')
    const resolve = async () => asset
    const original = await buildPublicationBundle(document, article, resolve)

    const captionChanged = structuredClone(document)
    const image = captionChanged.doc.content?.[1]?.content?.[0]
    if (!image?.attrs) throw new Error('Missing fixture image')
    image.attrs.caption = 'A changed caption'
    const captioned = await buildPublicationBundle(captionChanged, article, resolve)
    const tagged = await buildPublicationBundle(document, { ...article, tags: ['new'] }, resolve)
    const changedAsset = {
      ...asset,
      blob: new Blob(['different image bytes'], { type: asset.mimeType }),
    }
    const changedBinary = await buildPublicationBundle(
      document,
      article,
      async () => changedAsset,
    )

    expect(captioned.publicationHash).not.toBe(original.publicationHash)
    expect(tagged.publicationHash).not.toBe(original.publicationHash)
    expect(changedBinary.publicationHash).not.toBe(original.publicationHash)
    expect(captioned.bundle.document.markdown).toBe(original.bundle.document.markdown)
  })

  it('rejects images that are not backed by a local asset', async () => {
    const { document } = publicationDocument()
    await expect(
      buildPublicationBundle(document, defaultArticleState(document.id), async () => undefined),
    ).rejects.toMatchObject({ code: 'missing_asset' } satisfies Partial<PublicationBuildError>)
  })
})
