import { useEffect, useRef, useState } from 'react'
import { useDismissable } from '../../hooks/useDismissable'
import { IMAGE_ACCEPT } from '../../images/files'
import type { ImageUrlInsertRequest } from '../../images/url'
import { ImageIcon } from '../icons'

interface ImageInsertPopoverProps {
  anchor: DOMRect | null
  position: number
  onClose: () => void
  onInsertFiles: (files: File[], position: number) => void
  onInsertUrl: (request: ImageUrlInsertRequest) => Promise<void>
}

export function ImageInsertPopover({
  anchor,
  position,
  onClose,
  onInsertFiles,
  onInsertUrl,
}: ImageInsertPopoverProps) {
  const imageInput = useRef<HTMLInputElement>(null)
  const urlInput = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [alt, setAlt] = useState('')
  const [decorative, setDecorative] = useState(false)
  const [storeLocally, setStoreLocally] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const dismiss = () => {
    if (!pending) onClose()
  }
  const container = useDismissable<HTMLDivElement>(true, dismiss)

  useEffect(() => urlInput.current?.focus(), [])

  const submit = async () => {
    if (pending) return
    setPending(true)
    setError('')
    try {
      await onInsertUrl({ url, alt, decorative, storeLocally, position })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add image')
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className="image-insert-popover"
      ref={container}
      role="dialog"
      aria-label="Insert image"
      style={
        anchor
          ? {
              left: `${Math.max(12, Math.min(anchor.left, window.innerWidth - 372))}px`,
              top: `${anchor.bottom + 8}px`,
            }
          : undefined
      }
    >
      <button
        type="button"
        className="image-insert-popover__upload"
        onClick={() => imageInput.current?.click()}
      >
        <ImageIcon />
        Choose image files
      </button>
      <input
        ref={imageInput}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={event => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (!files.length) return
          onInsertFiles(files, position)
          onClose()
        }}
      />

      <div className="image-insert-popover__divider">or use an image URL</div>

      <label>
        <span>Image URL</span>
        <input
          ref={urlInput}
          type="url"
          value={url}
          placeholder="https://example.com/image.png"
          autoComplete="url"
          spellCheck={false}
          onChange={event => setUrl(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
      </label>

      <label>
        <span>Alt text</span>
        <input
          type="text"
          value={alt}
          disabled={decorative}
          placeholder={decorative ? 'Decorative image' : 'Describe the image'}
          onChange={event => setAlt(event.target.value)}
        />
      </label>

      <label className="image-insert-popover__check">
        <input
          type="checkbox"
          checked={decorative}
          onChange={event => setDecorative(event.target.checked)}
        />
        Decorative image
      </label>
      <label className="image-insert-popover__check">
        <input
          type="checkbox"
          checked={storeLocally}
          onChange={event => setStoreLocally(event.target.checked)}
        />
        Save a local copy for offline use
      </label>

      {error ? (
        <p className="image-insert-popover__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="image-insert-popover__actions">
        <button type="button" disabled={pending} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn--primary"
          disabled={pending}
          onClick={() => void submit()}
        >
          {pending ? 'Adding…' : 'Insert'}
        </button>
      </div>
    </div>
  )
}
