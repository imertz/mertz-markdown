import { createId } from '../lib/id'
import type { AssetRecord } from '../types'

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
] as const

export const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(',')

const EXTENSION_FOR_MIME: Record<(typeof IMAGE_MIME_TYPES)[number], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

const MIME_FROM_EXTENSION: Record<string, (typeof IMAGE_MIME_TYPES)[number]> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
}

export function imageMimeTypeForPath(
  path: string,
): (typeof IMAGE_MIME_TYPES)[number] | null {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME_FROM_EXTENSION[extension] ?? null
}

export function imageMimeType(file: File): (typeof IMAGE_MIME_TYPES)[number] | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return file.type as (typeof IMAGE_MIME_TYPES)[number]
  }
  return imageMimeTypeForPath(file.name)
}

export function isImageFile(file: File): boolean {
  return imageMimeType(file) !== null
}

export function assetMarkdownPath(asset: Pick<AssetRecord, 'storageName'>): string {
  return `images/${asset.storageName}`
}

export function defaultImageAlt(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
}

export async function validateImageFile(file: File): Promise<void> {
  if (!imageMimeType(file)) {
    throw new Error(`“${file.name || 'Clipboard image'}” is not a supported image`)
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`“${file.name || 'Clipboard image'}” is larger than 25 MiB`)
  }

  // createImageBitmap verifies the bytes where the browser provides it. The
  // node view remains the fallback verifier on older Safari releases.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      bitmap.close()
    } catch {
      throw new Error(`“${file.name || 'Clipboard image'}” could not be decoded`)
    }
  }
}

export function makeAssetRecord(docId: string, file: File): AssetRecord {
  const mimeType = imageMimeType(file)
  if (!mimeType) throw new Error('Unsupported image type')

  const id = createId()
  const extension = EXTENSION_FOR_MIME[mimeType]
  return {
    id,
    docId,
    blob: file,
    mimeType,
    originalName: file.name || `pasted-image.${extension}`,
    storageName: `${id}.${extension}`,
    size: file.size,
    createdAt: Date.now(),
  }
}
