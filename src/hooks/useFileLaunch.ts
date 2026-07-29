import { useEffect, useRef } from 'react'

export type ImportFile = (file: File) => void

/**
 * Open the `.md` files the OS handed us at launch.
 *
 * The manifest declares `file_handlers` for `text/markdown`, so a double-click
 * in Finder or Explorer already launches the installed app — this is what
 * makes the file actually arrive. `launch_handler: focus-existing` means a
 * running instance is reused, so the consumer can fire long after startup.
 *
 * The callback is held in a ref because `setConsumer` may only be called once
 * per page: re-registering on every render would either throw or silently
 * leave the first, stalest closure installed.
 */
export function useFileLaunch(onImport: ImportFile): void {
  const handler = useRef(onImport)
  useEffect(() => {
    handler.current = onImport
  })

  useEffect(() => {
    const queue = window.launchQueue
    if (!queue) return

    queue.setConsumer(params => {
      void (async () => {
        for (const entry of params.files) {
          try {
            const file = await entry.getFile()
            handler.current(file)
          } catch (error) {
            console.error('[launch] could not open a handed-off file', error)
          }
        }
      })()
    })
  }, [])
}
