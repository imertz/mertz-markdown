import { useEffect, useRef, useState } from 'react'
import { isImageFile } from '../images/files'
import { isBundleFile } from '../markdown/bundle'
import { isMarkdownFile } from '../markdown/import'
import type { ImportFile } from './useFileLaunch'

const carriesFiles = (event: DragEvent): boolean =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files')

const isOverEditor = (event: DragEvent): boolean =>
  event.target instanceof Element &&
  event.target.closest('.ProseMirror') !== null

/**
 * Import Markdown and bundle files dropped anywhere on the window, while
 * leaving editor image drops to TipTap. Returns whether a file drag is active
 * so the caller can show an overlay.
 *
 * Listens in the capture phase and stops file drags there: ProseMirror has its
 * own drop handling, and a document dropped on the editor would otherwise be
 * pasted in as a wall of literal text rather than opened as a document.
 * Drags that carry anything else are left entirely alone, so dragging text
 * around inside the editor still works.
 */
export function useFileDrop(onImport: ImportFile): boolean {
  const [active, setActive] = useState(false)
  const handler = useRef(onImport)
  // dragenter and dragleave fire once per element the pointer crosses, not
  // once per window, so leaving has to be counted rather than believed.
  const depth = useRef(0)

  useEffect(() => {
    handler.current = onImport
  })

  useEffect(() => {
    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      depth.current += 1
      setActive(true)
    }

    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    }

    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (isOverEditor(event) && files.length > 0 && files.every(isImageFile)) {
        return
      }
      // Without preventDefault the browser navigates to the file rather than
      // letting it be dropped.
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      depth.current = 0
      setActive(false)

      const files = Array.from(event.dataTransfer?.files ?? [])
      if (isOverEditor(event) && files.length > 0 && files.every(isImageFile)) {
        // FileHandler owns image drops because it maps pointer coordinates to
        // an exact document position. Capture must not swallow that event.
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const imports = files.filter(
        file => isMarkdownFile(file) || isBundleFile(file),
      )

      void (async () => {
        for (const file of imports) {
          try {
            handler.current(file)
          } catch (error) {
            console.error('[drop] could not read', file.name, error)
          }
        }
      })()
    }

    const options = { capture: true }
    window.addEventListener('dragenter', onEnter, options)
    window.addEventListener('dragleave', onLeave, options)
    window.addEventListener('dragover', onOver, options)
    window.addEventListener('drop', onDrop, options)

    return () => {
      window.removeEventListener('dragenter', onEnter, options)
      window.removeEventListener('dragleave', onLeave, options)
      window.removeEventListener('dragover', onOver, options)
      window.removeEventListener('drop', onDrop, options)
    }
  }, [])

  return active
}
