import type { Editor, JSONContent } from '@tiptap/core'
import { deleteAssets, putAssets } from '../db/assets'
import {
  assetMarkdownPath,
  defaultImageAlt,
} from './files'
import { makeImportedImageAsset } from './optimize'

export interface InsertImageFilesOptions {
  editor: Editor
  docId: string
  files: readonly File[]
  /** Override the generated filename-based alt text for a single image. */
  alternativeText?: string
  /** Abort a late async insertion after the user switches documents. */
  isCurrent?: () => boolean
  /** ProseMirror drop position; omitted for paste and the toolbar picker. */
  position?: number
}

/** Store first, then make one editor transaction reference the durable blobs. */
export async function insertImageFiles({
  editor,
  docId,
  files,
  alternativeText,
  isCurrent = () => true,
  position,
}: InsertImageFilesOptions): Promise<void> {
  if (!files.length) return
  if (!isCurrent()) throw new Error('The document changed before the image was ready')

  const assets = []
  for (const file of files) {
    assets.push(await makeImportedImageAsset(docId, file))
    if (!isCurrent()) {
      throw new Error('The document changed before the image was ready')
    }
  }
  await putAssets(assets)

  if (editor.isDestroyed || !isCurrent()) {
    await deleteAssets(assets.map(asset => asset.id))
    throw new Error('The document changed before the image was ready')
  }

  const nodes: JSONContent[] = assets.map(asset => ({
    type: 'image',
    attrs: {
      assetId: asset.id,
      src: assetMarkdownPath(asset),
      alt:
        files.length === 1 && alternativeText !== undefined
          ? alternativeText
          : defaultImageAlt(asset.originalName),
      title: null,
    },
  }))

  const inserted =
    position === undefined
      ? editor.commands.insertContent(nodes)
      : editor.commands.insertContentAt(
          Math.min(Math.max(0, position), editor.state.doc.content.size),
          nodes,
        )

  if (!inserted) {
    await deleteAssets(assets.map(asset => asset.id))
    throw new Error('The image could not be inserted at that position')
  }
}
