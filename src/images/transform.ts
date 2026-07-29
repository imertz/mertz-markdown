import type { Editor } from '@tiptap/core'
import { deleteAssets, putAssets } from '../db/assets'
import type { AssetRecord } from '../types'
import {
  assetMarkdownPath,
  makeAssetRecord,
  validateImageFile,
} from './files'
import { fetchImageFile } from './url'

export const CROPPED_IMAGE_MIME = 'image/webp'
export const CROPPED_IMAGE_QUALITY = 0.92

export interface ImageReplacementTarget {
  position: number
  expectedSrc: string
  expectedAssetId: string | null
}

const currentTargetMatches = (
  editor: Editor,
  target: ImageReplacementTarget,
): boolean => {
  const node = editor.state.doc.nodeAt(target.position)
  if (node?.type.name !== 'image') return false
  const assetId =
    typeof node.attrs.assetId === 'string' ? node.attrs.assetId : null
  return node.attrs.src === target.expectedSrc && assetId === target.expectedAssetId
}

async function replaceWithAsset(
  editor: Editor,
  target: ImageReplacementTarget,
  asset: AssetRecord,
  dimensions?: { width: number; height: number },
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) throw new Error('The document changed before the image was ready')
  await putAssets([asset])

  if (
    editor.isDestroyed ||
    !isCurrent() ||
    !currentTargetMatches(editor, target)
  ) {
    await deleteAssets([asset.id])
    throw new Error('The selected image changed before the operation completed')
  }

  const updated = editor
    .chain()
    .setNodeSelection(target.position)
    .updateAttributes('image', {
      assetId: asset.id,
      src: assetMarkdownPath(asset),
      ...(dimensions ?? {}),
    })
    .run()

  if (!updated) {
    await deleteAssets([asset.id])
    throw new Error('The image could not be updated')
  }
}

export async function localizeRemoteImage(
  editor: Editor,
  docId: string,
  target: ImageReplacementTarget,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (target.expectedAssetId) return
  const file = await fetchImageFile(target.expectedSrc)
  await replaceWithAsset(
    editor,
    target,
    makeAssetRecord(docId, file),
    undefined,
    isCurrent,
  )
}

export function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob || blob.type !== CROPPED_IMAGE_MIME) {
          reject(new Error('This browser could not encode the cropped image'))
          return
        }
        resolve(blob)
      },
      CROPPED_IMAGE_MIME,
      CROPPED_IMAGE_QUALITY,
    )
  })
}

export async function replaceImageWithCrop(
  editor: Editor,
  docId: string,
  target: ImageReplacementTarget,
  canvas: HTMLCanvasElement,
  displayWidth: number,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const blob = await canvasToWebp(canvas)
  const file = new File([blob], 'cropped-image.webp', {
    type: CROPPED_IMAGE_MIME,
  })
  await validateImageFile(file)

  const width = Math.max(48, Math.round(displayWidth || canvas.width))
  const height = Math.max(1, Math.round(width * (canvas.height / canvas.width)))
  await replaceWithAsset(
    editor,
    target,
    makeAssetRecord(docId, file),
    { width, height },
    isCurrent,
  )
}
