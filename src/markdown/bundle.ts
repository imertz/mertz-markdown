import type { Editor, JSONContent } from '@tiptap/core'
import { strFromU8, unzip, zip, type AsyncZippable } from 'fflate'
import { getDocumentAsset } from '../db/assets'
import {
  assetMarkdownPath,
  imageMimeTypeForPath,
  makeAssetRecord,
  MAX_IMAGE_BYTES,
  validateImageFile,
} from '../images/files'
import type { AssetRecord } from '../types'
import { toMarkdown } from './export'
import { titleFromFilename } from './import'
import {
  createMarkdownManager,
  serializeWithManager,
} from './manager'

const ZIP_MIME = 'application/zip'
const MARKDOWN_FILE = /\.(md|markdown|mdown|mkd)$/i

export const BUNDLE_ACCEPT = '.zip,application/zip,application/x-zip-compressed'

export function isBundleFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.zip') || file.type === ZIP_MIME
}

const safeStem = (value: string): string =>
  value.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 100) || 'document'

interface LocalImageReference {
  assetId: string
  src: string
}

export function collectLocalImageReferences(
  doc: JSONContent,
): LocalImageReference[] {
  const found = new Map<string, string>()
  const walk = (node: JSONContent) => {
    if (node.type === 'image') {
      const assetId =
        typeof node.attrs?.assetId === 'string' ? node.attrs.assetId : ''
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      if (assetId) found.set(assetId, src)
    }
    node.content?.forEach(walk)
  }
  walk(doc)
  return [...found].map(([assetId, src]) => ({ assetId, src }))
}

function zipAsync(files: AsyncZippable): Promise<Blob> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => {
      if (error) reject(error)
      else resolve(new Blob([data], { type: ZIP_MIME }))
    })
  })
}

export interface DocumentExport {
  blob: Blob
  filename: string
  bundled: boolean
}

/** Plain Markdown when possible; a portable Markdown + images ZIP otherwise. */
export async function buildDocumentExport(
  editor: Editor,
  docId: string,
  title: string,
): Promise<DocumentExport> {
  const markdown = toMarkdown(editor)
  const stem = safeStem(title)
  const references = collectLocalImageReferences(editor.getJSON())

  if (!references.length) {
    return {
      blob: new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      filename: `${stem}.md`,
      bundled: false,
    }
  }

  const files: AsyncZippable = {
    [`${stem}.md`]: new TextEncoder().encode(markdown),
  }

  for (const reference of references) {
    const asset = await getDocumentAsset(docId, reference.assetId)
    if (!asset) throw new Error('A referenced image is missing from browser storage')
    const expected = assetMarkdownPath(asset)
    if (reference.src !== expected) {
      throw new Error('A local image has an inconsistent export path')
    }
    files[expected] = new Uint8Array(await asset.blob.arrayBuffer())
  }

  return {
    blob: await zipAsync(files),
    filename: `${stem}.zip`,
    bundled: true,
  }
}

export function downloadFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function unzipAsync(file: File): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    void file
      .arrayBuffer()
      .then(buffer => {
        unzip(new Uint8Array(buffer), (error, entries) => {
          if (error) reject(error)
          else resolve(entries)
        })
      })
      .catch(reject)
  })
}

const unsafeArchivePath = (path: string): boolean => {
  if (!path || path.includes('\\') || path.startsWith('/')) return true
  const parts = path.split('/')
  // ZIPs created by other tools commonly include explicit `images/`
  // directory entries. The trailing empty part is harmless; empty parts in
  // the middle and dot segments are ambiguous or traversal attempts.
  if (path.endsWith('/')) parts.pop()
  return (
    parts.length === 0 ||
    parts.some(part => part === '' || part === '.' || part === '..')
  )
}

function replaceImages(
  node: JSONContent,
  byPath: ReadonlyMap<string, AssetRecord>,
): JSONContent {
  const content = node.content?.map(child => replaceImages(child, byPath))
  if (node.type !== 'image') return content ? { ...node, content } : node

  const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
  const asset = byPath.get(src)
  if (!asset) return content ? { ...node, content } : node
  return {
    ...node,
    attrs: {
      ...node.attrs,
      assetId: asset.id,
      src: assetMarkdownPath(asset),
    },
    ...(content ? { content } : {}),
  }
}

export interface ImportedBundle {
  title: string
  doc: JSONContent
  markdown: string
  assets: AssetRecord[]
}

/** Import the app's deliberately manifest-free, standard Markdown bundle. */
export async function readDocumentBundle(
  file: File,
  docId: string,
): Promise<ImportedBundle> {
  const entries = await unzipAsync(file)
  const names = Object.keys(entries)
  if (names.some(unsafeArchivePath)) {
    throw new Error('The bundle contains an unsafe path')
  }
  const fileNames = names.filter(name => !name.endsWith('/'))

  const markdownNames = fileNames.filter(
    name => !name.includes('/') && MARKDOWN_FILE.test(name),
  )
  if (markdownNames.length !== 1) {
    throw new Error('A bundle must contain exactly one Markdown file at its root')
  }

  const markdownName = markdownNames[0]
  const markdownBytes = markdownName ? entries[markdownName] : undefined
  if (!markdownName || !markdownBytes) throw new Error('The Markdown file is empty')

  const source = strFromU8(markdownBytes)
  const manager = createMarkdownManager()
  const parsed = manager.parse(source)
  const references = collectImagePaths(parsed).filter(path => path.startsWith('images/'))
  const assets: AssetRecord[] = []
  const byPath = new Map<string, AssetRecord>()

  for (const path of new Set(references)) {
    if (unsafeArchivePath(path)) throw new Error('The Markdown references an unsafe image path')
    const bytes = entries[path]
    if (!bytes) throw new Error(`The bundle is missing ${path}`)
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`${path} is larger than 25 MiB`)
    }
    const mimeType = imageMimeTypeForPath(path)
    if (!mimeType) throw new Error(`${path} is not a supported image type`)

    const image = new File([bytes.slice().buffer as ArrayBuffer], path.split('/').pop() ?? 'image', {
      type: mimeType,
    })
    await validateImageFile(image)
    const asset = makeAssetRecord(docId, image)
    assets.push(asset)
    byPath.set(path, asset)
  }

  const doc = replaceImages(parsed, byPath)
  return {
    title: titleFromFilename(markdownName),
    doc,
    markdown: serializeWithManager(manager, doc),
    assets,
  }
}

function collectImagePaths(doc: JSONContent): string[] {
  const paths: string[] = []
  const walk = (node: JSONContent) => {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') {
      paths.push(node.attrs.src)
    }
    node.content?.forEach(walk)
  }
  walk(doc)
  return paths
}
