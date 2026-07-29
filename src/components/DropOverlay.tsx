import { UploadIcon } from './icons'

/**
 * Shown while a file drag is over the window.
 *
 * `aria-hidden` because it is feedback for a gesture assistive technology
 * cannot perform; the Import button in the header is the equivalent path and
 * is always there.
 */
export function DropOverlay() {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-overlay__card">
        <UploadIcon width={22} height={22} />
        <span>Drop Markdown or ZIP to open · images into the document</span>
      </div>
    </div>
  )
}
