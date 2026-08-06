import type { Editor, JSONContent } from '@tiptap/core'
import {
  strFromU8,
  Unzip,
  UnzipInflate,
  UnzipPassThrough,
  zip,
  type AsyncZippable,
  type UnzipFile,
} from 'fflate'
import { getDocumentAsset } from '../db/assets'
import {
  assetMarkdownPath,
  imageMimeTypeForPath,
  MAX_IMAGE_BYTES,
} from '../images/files'
import { makeImportedImageAsset } from '../images/optimize'
import { safeStem } from '../lib/filename'
import type { AssetRecord } from '../types'
import { toMarkdown } from './export'
import { titleFromFilename } from './import'
import {
  createMarkdownManager,
  serializeWithManager,
} from './manager'

const ZIP_MIME = 'application/zip'
const MARKDOWN_FILE = /\.(md|markdown|mdown|mkd)$/i

/** Work-amplification caps for bundle import. */
const MAX_BUNDLE_INPUT_BYTES = 200 * 1024 * 1024
const MAX_BUNDLE_INFLATED_BYTES = 500 * 1024 * 1024
const MAX_BUNDLE_ENTRIES = 5000

export const BUNDLE_ACCEPT = '.zip,application/zip,application/x-zip-compressed'

export function isBundleFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.zip') || file.type === ZIP_MIME
}

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

export interface BundleImportLimits {
  inputBytes: number
  inflatedBytes: number
  entries: number
}

const DEFAULT_BUNDLE_LIMITS: BundleImportLimits = {
  inputBytes: MAX_BUNDLE_INPUT_BYTES,
  inflatedBytes: MAX_BUNDLE_INFLATED_BYTES,
  entries: MAX_BUNDLE_ENTRIES,
}

/**
 * Extract a ZIP incrementally, stopping before a malicious archive can
 * allocate more than the configured inflated-byte allowance.
 */
export async function unzipBundleWithLimits(
  file: File,
  limits: BundleImportLimits = DEFAULT_BUNDLE_LIMITS,
): Promise<Record<string, Uint8Array>> {
  if (file.size > limits.inputBytes) {
    throw new Error('The bundle is larger than 200 MiB')
  }

  const reader = file.stream().getReader()
  const entries: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >
  const active = new Set<UnzipFile>()
  let entryCount = 0
  let inflatedBytes = 0
  let pendingFiles = 0
  let inputDone = false
  let settled = false

  return await new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      for (const entry of active) entry.terminate()
      active.clear()
      void reader.cancel(error).catch(() => undefined)
      reject(error instanceof Error ? error : new Error('The bundle is invalid'))
    }

    const finishIfReady = () => {
      if (settled || !inputDone || pendingFiles !== 0) return
      settled = true
      resolve(entries)
    }

    const archive = new Unzip(entry => {
      if (settled) return
      entryCount += 1
      if (entryCount > limits.entries) {
        fail(new Error('The bundle contains too many files'))
        return
      }
      if (unsafeArchivePath(entry.name)) {
        fail(new Error('The bundle contains an unsafe path'))
        return
      }
      if (
        typeof entry.originalSize === 'number' &&
        inflatedBytes + entry.originalSize > limits.inflatedBytes
      ) {
        fail(new Error('The bundle expands beyond the safe size limit'))
        return
      }

      const chunks: Uint8Array[] = []
      let entryBytes = 0
      pendingFiles += 1
      active.add(entry)
      entry.ondata = (error, chunk, final) => {
        if (settled) return
        if (error) {
          fail(error)
          return
        }
        entryBytes += chunk.byteLength
        inflatedBytes += chunk.byteLength
        if (inflatedBytes > limits.inflatedBytes) {
          fail(new Error('The bundle expands beyond the safe size limit'))
          return
        }
        if (chunk.byteLength) chunks.push(chunk)
        if (!final) return

        const contents = new Uint8Array(entryBytes)
        let offset = 0
        for (const part of chunks) {
          contents.set(part, offset)
          offset += part.byteLength
        }
        entries[entry.name] = contents
        active.delete(entry)
        pendingFiles -= 1
        finishIfReady()
      }
      try {
        entry.start()
      } catch (error) {
        fail(error)
      }
    })
    archive.register(UnzipPassThrough)
    archive.register(UnzipInflate)

    const pump = async () => {
      try {
        while (!settled) {
          const { done, value } = await reader.read()
          if (done) {
            archive.push(new Uint8Array(), true)
            inputDone = true
            finishIfReady()
            return
          }
          // Blob stream chunking is implementation-defined. Bound each call
          // into the synchronous DEFLATE decoder so one highly-compressible
          // source chunk cannot create an arbitrarily large temporary output
          // before ondata gets the chance to enforce the aggregate limit.
          const compressedChunkBytes = 32 * 1024
          for (let offset = 0; offset < value.byteLength && !settled; offset += compressedChunkBytes) {
            archive.push(value.subarray(offset, offset + compressedChunkBytes))
          }
        }
      } catch (error) {
        fail(error)
      }
    }
    void pump()
  })
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
  const entries = await unzipBundleWithLimits(file)
  const names = Object.keys(entries)
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
    const asset = await makeImportedImageAsset(docId, image)
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
