import type { JSONContent } from '@tiptap/core'
import { getDocumentAsset } from '../../db/assets'
import type { AssetRecord, DocumentRecord } from '../../types'
import type { BlogArticleState } from './state'

export interface PublicationImage {
  assetId: string | null
  path: string
  sha256: string
  mimeType: string
  alt: string | null
  title: string | null
  caption: string | null
  width: number | null
  height: number | null
  alignment: 'left' | 'center' | 'right' | null
}

export interface PublicationBundleV1 {
  protocol: 'mertz-publication/1'
  document: {
    id: string
    revision: string
    title: string
    markdown: string
  }
  article: {
    draft: boolean
    tags: string[]
  }
  images: PublicationImage[]
}

export interface BuiltPublication {
  bundle: PublicationBundleV1
  publicationHash: string
  files: Map<number, AssetRecord>
}

export type PublicationBuildErrorCode =
  | 'missing_asset'
  | 'remote_image'
  | 'invalid_image_path'
  | 'conflicting_image_metadata'

export class PublicationBuildError extends Error {
  constructor(
    readonly code: PublicationBuildErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PublicationBuildError'
  }
}

function normalizedText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null
}

function alignment(value: unknown): PublicationImage['alignment'] {
  return value === 'left' || value === 'center' || value === 'right'
    ? value
    : null
}

export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export async function sha256Hex(value: string | Blob): Promise<string> {
  const bytes =
    typeof value === 'string'
      ? new TextEncoder().encode(value)
      : new Uint8Array(await value.arrayBuffer())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

interface ImageNode {
  attrs: Record<string, unknown>
}

function collectImageNodes(doc: JSONContent): ImageNode[] {
  const images: ImageNode[] = []
  const visit = (node: JSONContent) => {
    if (node.type === 'image') images.push({ attrs: node.attrs ?? {} })
    node.content?.forEach(visit)
  }
  visit(doc)
  return images
}

export async function buildPublicationBundle(
  document: DocumentRecord,
  article: Pick<BlogArticleState, 'draft' | 'tags'>,
  resolveAsset: (
    documentId: string,
    assetId: string,
  ) => Promise<AssetRecord | undefined> = getDocumentAsset,
): Promise<BuiltPublication> {
  const images: PublicationImage[] = []
  const files = new Map<number, AssetRecord>()
  const seen = new Map<string, string>()

  for (const node of collectImageNodes(document.doc)) {
    const assetId = normalizedText(node.attrs.assetId)
    const path = normalizedText(node.attrs.src)
    if (!assetId) {
      throw new PublicationBuildError(
        'remote_image',
        'Save every remote image locally before publishing',
      )
    }
    if (!path?.startsWith('images/')) {
      throw new PublicationBuildError(
        'invalid_image_path',
        `Image ${assetId} does not use a portable images/ path`,
      )
    }
    const asset = await resolveAsset(document.id, assetId)
    if (!asset) {
      throw new PublicationBuildError(
        'missing_asset',
        `Image ${path} is missing from browser storage`,
      )
    }
    if (path !== `images/${asset.storageName}`) {
      throw new PublicationBuildError(
        'invalid_image_path',
        `Image ${path} does not match its stored asset`,
      )
    }

    const image: PublicationImage = {
      assetId,
      path,
      sha256: await sha256Hex(asset.blob),
      mimeType: asset.mimeType,
      alt: normalizedText(node.attrs.alt),
      title: normalizedText(node.attrs.title),
      caption: normalizedText(node.attrs.caption),
      width: positiveNumber(node.attrs.width),
      height: positiveNumber(node.attrs.height),
      alignment: alignment(node.attrs.alignment),
    }
    const metadata = canonicalJson(image)
    const previous = seen.get(assetId)
    if (previous && previous !== metadata) {
      throw new PublicationBuildError(
        'conflicting_image_metadata',
        `Image ${path} is used more than once with different metadata`,
      )
    }
    if (previous) continue
    seen.set(assetId, metadata)
    files.set(images.length, asset)
    images.push(image)
  }

  const revision = await sha256Hex(
    canonicalJson({ title: document.title, doc: document.doc }),
  )
  const bundle: PublicationBundleV1 = {
    protocol: 'mertz-publication/1',
    document: {
      id: document.id,
      revision,
      title: document.title,
      markdown: document.markdown,
    },
    article: {
      draft: article.draft,
      tags: normalizeTags(article.tags),
    },
    images,
  }
  const publicationHash = await sha256Hex(
    canonicalJson({
      protocol: bundle.protocol,
      title: bundle.document.title,
      markdown: bundle.document.markdown,
      article: bundle.article,
      images: bundle.images,
    }),
  )

  return { bundle, publicationHash, files }
}
