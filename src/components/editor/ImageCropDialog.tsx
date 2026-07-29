import Cropper, {
  type CropperImage,
  type CropperSelection,
} from 'cropperjs'
import { useEffect, useRef, useState } from 'react'
import { useDismissable } from '../../hooks/useDismissable'

const TEMPLATE = `
<cropper-canvas background>
  <cropper-image initial-center-size="cover" scalable translatable></cropper-image>
  <cropper-shade hidden></cropper-shade>
  <cropper-handle action="select" plain></cropper-handle>
  <cropper-selection initial-coverage="0.72" movable resizable keyboard outlined>
    <cropper-grid role="grid" bordered covered></cropper-grid>
    <cropper-crosshair centered></cropper-crosshair>
    <cropper-handle action="move" theme-color="rgba(255, 255, 255, 0.35)"></cropper-handle>
    <cropper-handle action="n-resize"></cropper-handle>
    <cropper-handle action="e-resize"></cropper-handle>
    <cropper-handle action="s-resize"></cropper-handle>
    <cropper-handle action="w-resize"></cropper-handle>
    <cropper-handle action="ne-resize"></cropper-handle>
    <cropper-handle action="nw-resize"></cropper-handle>
    <cropper-handle action="se-resize"></cropper-handle>
    <cropper-handle action="sw-resize"></cropper-handle>
  </cropper-selection>
</cropper-canvas>
`

type Aspect = 'free' | 'original' | '1:1' | '4:3' | '16:9'

const ASPECTS: Record<Exclude<Aspect, 'free' | 'original'>, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
}

interface ImageCropDialogProps {
  source: Blob
  alt: string
  onApply: (canvas: HTMLCanvasElement) => Promise<void>
  onClose: () => void
}

export function ImageCropDialog({
  source,
  alt,
  onApply,
  onClose,
}: ImageCropDialogProps) {
  const host = useRef<HTMLDivElement>(null)
  const cropper = useRef<Cropper | null>(null)
  const selection = useRef<CropperSelection | null>(null)
  const cropperImage = useRef<CropperImage | null>(null)
  const originalAspect = useRef(1)
  const zoomValue = useRef(1)
  const [aspect, setAspectState] = useState<Aspect>('free')
  const [zoom, setZoom] = useState(1)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const dismiss = () => {
    if (!pending) onClose()
  }
  const panel = useDismissable<HTMLDivElement>(true, dismiss)

  useEffect(() => {
    if (!host.current) return
    const sourceUrl = URL.createObjectURL(source)
    const image = new Image()
    image.src = sourceUrl
    image.alt = alt

    const instance = new Cropper(image, {
      container: host.current,
      template: TEMPLATE,
    })
    cropper.current = instance
    selection.current = instance.getCropperSelection()
    cropperImage.current = instance.getCropperImage()
    void cropperImage.current?.$ready(loaded => {
      originalAspect.current = loaded.naturalWidth / loaded.naturalHeight
    })

    return () => {
      instance.destroy()
      URL.revokeObjectURL(sourceUrl)
      cropper.current = null
      selection.current = null
      cropperImage.current = null
    }
  }, [alt, source])

  const setAspect = (next: Aspect) => {
    const selected = selection.current
    if (!selected) return
    const ratio =
      next === 'free'
        ? Number.NaN
        : next === 'original'
          ? originalAspect.current
          : ASPECTS[next]
    selected.aspectRatio = ratio
    selected.$change(
      selected.x,
      selected.y,
      selected.width,
      selected.height,
      ratio,
      true,
    )
    selected.$center()
    setAspectState(next)
  }

  const changeZoom = (next: number) => {
    const image = cropperImage.current
    if (!image) return
    const clamped = Math.min(3, Math.max(1, next))
    const factor = clamped / zoomValue.current
    image.$zoom(factor >= 1 ? factor - 1 : 1 - 1 / factor)
    zoomValue.current = clamped
    setZoom(clamped)
  }

  const apply = async () => {
    const selected = selection.current
    const image = cropperImage.current
    if (!selected || !image || pending) return
    setPending(true)
    setError('')
    try {
      const [scaleX] = image.$getTransform()
      const nativeWidth = Math.max(
        1,
        Math.round(selected.width / Math.max(Math.abs(scaleX ?? 1), 0.0001)),
      )
      const nativeHeight = Math.max(
        1,
        Math.round(nativeWidth * (selected.height / selected.width)),
      )
      const canvas = await selected.$toCanvas({
        width: nativeWidth,
        height: nativeHeight,
      })
      await onApply(canvas)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not crop image')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="crop-dialog-backdrop">
      <div
        className="crop-dialog"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Crop image"
      >
        <header className="crop-dialog__header">
          <h2>Crop image</h2>
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            aria-label="Close crop dialog"
          >
            ×
          </button>
        </header>

        <div className="crop-dialog__canvas" ref={host} />

        <div className="crop-dialog__controls">
          <div
            className="crop-dialog__aspects"
            role="group"
            aria-label="Crop aspect ratio"
          >
            {(['free', 'original', '1:1', '4:3', '16:9'] as const).map(
              value => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={aspect === value}
                  onClick={() => setAspect(value)}
                >
                  {value === 'free'
                    ? 'Free'
                    : value === 'original'
                      ? 'Original'
                      : value}
                </button>
              ),
            )}
          </div>

          <label className="crop-dialog__zoom">
            <span>Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={event => changeZoom(Number(event.target.value))}
            />
          </label>
        </div>

        {error ? (
          <p className="crop-dialog__error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="crop-dialog__actions">
          <button type="button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn--primary"
            disabled={pending}
            onClick={() => void apply()}
          >
            {pending ? 'Applying…' : 'Apply crop'}
          </button>
        </footer>
      </div>
    </div>
  )
}
