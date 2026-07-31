import type { AssetRecord } from '../types'
import {
  makeAssetRecord,
  validateImageFile,
  validateImageFileMetadata,
} from './files'

export const IMPORTED_IMAGE_MAX_EDGE = 1920
export const IMPORTED_IMAGE_MIME = 'image/webp'
export const IMPORTED_IMAGE_QUALITY = 0.85

export interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

const decodeError = (file: File): Error =>
  new Error(`“${file.name || 'Clipboard image'}” could not be decoded`)

/**
 * Intrinsic pixel dimensions plus a source a canvas can draw.
 *
 * Exported for the DOCX exporter, which needs the same two things — real
 * dimensions, and a way to re-encode formats Word will not display.
 */
export async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      throw decodeError(file)
    }
  }

  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw decodeError(file)
  }

  const objectUrl = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(decodeError(file))
      image.src = objectUrl
    })
  } catch {
    URL.revokeObjectURL(objectUrl)
    throw decodeError(file)
  }

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(objectUrl),
  }
}

/**
 * `canvas.toBlob` as a promise, with the type check the callers need.
 *
 * The check is not paranoia: `toBlob` falls back to PNG for a format the
 * browser cannot encode, so without it a Safari that lacks WebP would hand
 * back PNG bytes under a `.webp` name.
 */
export function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
  failureMessage: string,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob || blob.type !== mimeType) {
          reject(new Error(failureMessage))
          return
        }
        resolve(blob)
      },
      mimeType,
      quality,
    )
  })
}

export function encodeCanvasAsWebp(
  canvas: HTMLCanvasElement,
  quality: number,
  failureMessage: string,
): Promise<Blob> {
  return encodeCanvas(canvas, IMPORTED_IMAGE_MIME, quality, failureMessage)
}

function webpFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '') || 'pasted-image'
  return `${stem}.webp`
}

function containedDimensions(width: number, height: number): {
  width: number
  height: number
} {
  const longestEdge = Math.max(width, height)
  if (longestEdge <= IMPORTED_IMAGE_MAX_EDGE) return { width, height }

  const scale = IMPORTED_IMAGE_MAX_EDGE / longestEdge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Normalize a newly stored still image without mutating document or DB state. */
export async function optimizeImportedImage(file: File): Promise<File> {
  const mimeType = validateImageFileMetadata(file)

  // Re-encoding a GIF through canvas would silently discard its animation.
  if (mimeType === 'image/gif') {
    await validateImageFile(file)
    return file
  }

  const decoded = await decodeImage(file)
  try {
    if (
      !Number.isFinite(decoded.width) ||
      !Number.isFinite(decoded.height) ||
      decoded.width < 1 ||
      decoded.height < 1
    ) {
      throw decodeError(file)
    }

    const dimensions = containedDimensions(decoded.width, decoded.height)
    if (
      mimeType === IMPORTED_IMAGE_MIME &&
      dimensions.width === decoded.width &&
      dimensions.height === decoded.height
    ) {
      return file
    }

    if (typeof document === 'undefined') {
      throw new Error('This browser could not optimize the imported image')
    }
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('This browser could not optimize the imported image')
    }
    context.drawImage(
      decoded.source,
      0,
      0,
      dimensions.width,
      dimensions.height,
    )

    const blob = await encodeCanvasAsWebp(
      canvas,
      IMPORTED_IMAGE_QUALITY,
      'This browser could not encode the imported image as WebP',
    )
    return new File([blob], webpFilename(file.name), {
      type: IMPORTED_IMAGE_MIME,
      lastModified: file.lastModified,
    })
  } finally {
    decoded.close()
  }
}

export async function makeImportedImageAsset(
  docId: string,
  file: File,
): Promise<AssetRecord> {
  const optimized = await optimizeImportedImage(file)
  return makeAssetRecord(docId, optimized, file.name)
}
