import { useCallback, useRef, useState } from 'react'
import { useDismissable } from '../../hooks/useDismissable'
import { BUNDLE_ACCEPT } from '../../markdown/bundle'
import { MARKDOWN_ACCEPT } from '../../markdown/import'
import { ChevronDownIcon, DownloadIcon, UploadIcon } from '../icons'
import { FORMATS, type ExportActions } from './exportFormats'

export interface ExportMenuProps extends ExportActions {
  onImport: (file: File) => void
  disabled?: boolean
}

/**
 * Export as a format menu, Import as its peer.
 *
 * Four formats is past what a row of buttons can hold, and flattening them
 * would also flatten the distinction the app cares most about: two of these
 * carry the comment threads and two are guaranteed not to. A menu can say that
 * next to each item; a row of icons cannot.
 */
export function ExportMenu(props: ExportMenuProps) {
  const { onImport, disabled } = props
  const fileInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const container = useDismissable<HTMLDivElement>(open, close)

  return (
    <div
      className="export-menu"
      role="group"
      aria-label="Document file actions"
      ref={container}
    >
      <button
        type="button"
        className="export-menu__trigger"
        disabled={disabled}
        title="Download this document"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(value => !value)}
      >
        <DownloadIcon width={14} height={14} />
        Export
        <ChevronDownIcon className="export-menu__chevron" width={12} height={12} />
      </button>

      <button
        type="button"
        disabled={disabled}
        title="Open a Markdown file or Markdown + images ZIP as a new document"
        onClick={() => fileInput.current?.click()}
      >
        <UploadIcon width={14} height={14} />
        Import
      </button>

      {open ? (
        <div className="export-menu__panel" role="menu" aria-label="Export format">
          {FORMATS.map(format => (
            <button
              key={format.id}
              type="button"
              role="menuitem"
              className="export-menu__option"
              onClick={() => {
                close()
                format.run(props)
              }}
            >
              <span className="export-menu__option-name">{format.label}</span>
              <span className="export-menu__option-hint">{format.hint}</span>
            </button>
          ))}
        </div>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept={`${MARKDOWN_ACCEPT},${BUNDLE_ACCEPT}`}
        hidden
        onChange={event => {
          const file = event.target.files?.[0]
          // Reset first so choosing the same file twice still fires a change.
          event.target.value = ''
          if (!file) return
          onImport(file)
        }}
      />
    </div>
  )
}
