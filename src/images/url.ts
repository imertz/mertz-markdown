import type { Editor, JSONContent } from '@tiptap/core'
import { imageMimeType, MAX_IMAGE_BYTES, validateImageFile } from './files'
import { insertImageFiles } from './insert'

export interface ImageUrlInsertRequest {
  url: string
  alt: string
  decorative: boolean
  storeLocally: boolean
  position: number
}

export interface InsertImageUrlOptions extends ImageUrlInsertRequest {
  editor: Editor
  docId: string
  isCurrent?: () => boolean
}

/** An image source must be a network URL, never executable or browser-local. */
export function normalizeImageUrl(raw: string): string {
  const value = raw.trim()
  if (!value) return ''

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : `https://${value}`

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (url.username || url.password) return ''
    return url.href
  } catch {
    return ''
  }
}

const filenameFromUrl = (url: string): string => {
  const name = new URL(url).pathname.split('/').filter(Boolean).pop()
  if (!name) return 'remote-image'
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** Fetch a CORS-readable URL and turn it into the same validated input as a picker file. */
export async function fetchImageFile(url: string): Promise<File> {
  let response: Response
  try {
    response = await fetch(url, {
      credentials: 'omit',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    throw new Error(
      'The image could not be downloaded. The host may block cross-origin access.',
    )
  }

  if (!response.ok) {
    throw new Error(`The image host returned HTTP ${response.status}`)
  }

  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
    throw new Error('The remote image is larger than 25 MiB')
  }

  const blob = await response.blob()
  const name = filenameFromUrl(url)
  const file = new File([blob], name, { type: blob.type })
  await validateImageFile(file)
  const validatedType = imageMimeType(file)
  return file.type === validatedType
    ? file
    : new File([blob], name, { type: validatedType ?? blob.type })
}

const insertAt = (
  editor: Editor,
  position: number,
  node: JSONContent,
): boolean =>
  editor.commands.insertContentAt(
    Math.min(Math.max(0, position), editor.state.doc.content.size),
    node,
  )

export async function insertImageUrl({
  editor,
  docId,
  url: rawUrl,
  alt: rawAlt,
  decorative,
  storeLocally,
  position,
  isCurrent = () => true,
}: InsertImageUrlOptions): Promise<void> {
  const url = normalizeImageUrl(rawUrl)
  if (!url) throw new Error('Enter a valid HTTP or HTTPS image URL')

  const alt = decorative ? '' : rawAlt.trim()
  if (!decorative && !alt) {
    throw new Error('Describe the image or mark it as decorative')
  }

  if (storeLocally) {
    const file = await fetchImageFile(url)
    await insertImageFiles({
      editor,
      docId,
      files: [file],
      alternativeText: alt,
      isCurrent,
      position,
    })
    return
  }

  if (editor.isDestroyed || !isCurrent()) {
    throw new Error('The document changed before the image was ready')
  }
  const inserted = insertAt(editor, position, {
    type: 'image',
    attrs: { src: url, alt, title: null, assetId: null },
  })
  if (!inserted) throw new Error('The image could not be inserted at that position')
}
