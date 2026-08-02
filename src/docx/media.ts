import type { ImageMimeType } from '../images/files'
import { decodeImage, encodeCanvas } from '../images/optimize'

/**
 * Image bytes, in a format Word will actually draw.
 *
 * Word's raster support stops at PNG, JPEG, GIF and a handful of legacy
 * formats. **WebP is version-dependent and AVIF is not supported at all** —
 * and this app stores almost every local image as WebP. (Imports and crops use
 * PNG only when the browser cannot encode WebP.) Embedding those formats
 * unchanged would therefore give most users a document full of empty frames,
 * so they are re-encoded to PNG on the way out.
 */

export interface PreparedImage {
  bytes: Uint8Array
  /** Lowercase, no dot. Drives the `Default` content-type entry. */
  extension: string
  /** Intrinsic pixel dimensions, after any re-encode. */
  width: number
  height: number
}

/**
 * Injected so the exporter can be tested. Canvas and `createImageBitmap` do not
 * exist under happy-dom, which would otherwise put every image path out of
 * reach of the suite — the same reason `LocalImage` takes `resolveAsset`
 * instead of reaching for the database itself.
 */
export type ImagePreparer = (
  blob: Blob,
  mimeType: string,
  name: string,
) => Promise<PreparedImage>

const PASS_THROUGH: Partial<Record<ImageMimeType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
}

const PNG_MIME = 'image/png'

const bytesOf = async (blob: Blob): Promise<Uint8Array> =>
  new Uint8Array(await blob.arrayBuffer())

/** Re-encode through a canvas at the image's own size. */
async function toPng(
  decoded: Awaited<ReturnType<typeof decodeImage>>,
  name: string,
): Promise<Blob> {
  if (typeof document === 'undefined') {
    throw new Error(`“${name}” could not be converted for Word`)
  }

  const canvas = document.createElement('canvas')
  canvas.width = decoded.width
  canvas.height = decoded.height

  const context = canvas.getContext('2d')
  if (!context) throw new Error(`“${name}” could not be converted for Word`)
  context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height)

  // Quality is ignored for PNG, which is lossless; the argument is positional.
  return encodeCanvas(canvas, PNG_MIME, 1, `“${name}” could not be converted for Word`)
}

/** The real, browser-backed preparer. */
export const prepareImage: ImagePreparer = async (blob, mimeType, name) => {
  // decodeImage wants a File for its error messages; the bytes are the same.
  const file = new File([blob], name || 'image', { type: mimeType })
  const decoded = await decodeImage(file)

  try {
    if (
      !Number.isFinite(decoded.width) ||
      !Number.isFinite(decoded.height) ||
      decoded.width < 1 ||
      decoded.height < 1
    ) {
      throw new Error(`“${name}” could not be read`)
    }

    const extension = PASS_THROUGH[mimeType as ImageMimeType]
    if (extension) {
      return {
        bytes: await bytesOf(blob),
        extension,
        width: decoded.width,
        height: decoded.height,
      }
    }

    return {
      bytes: await bytesOf(await toPng(decoded, name)),
      extension: 'png',
      width: decoded.width,
      height: decoded.height,
    }
  } finally {
    decoded.close()
  }
}

/**
 * Collects the media parts as the document walk meets images, so an asset used
 * twice is stored once and referenced twice.
 */
export class MediaRegistry {
  private readonly parts: { path: string; bytes: Uint8Array }[] = []
  private readonly byKey = new Map<string, string>()

  /** Returns the package-relative path, adding the part on first use. */
  add(key: string, prepared: PreparedImage): string {
    const existing = this.byKey.get(key)
    if (existing) return existing

    const path = `media/image${this.parts.length + 1}.${prepared.extension}`
    this.parts.push({ path, bytes: prepared.bytes })
    this.byKey.set(key, path)
    return path
  }

  get media(): readonly { path: string; bytes: Uint8Array }[] {
    return this.parts
  }
}
