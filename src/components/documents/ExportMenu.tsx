import { useRef } from 'react'
import { BUNDLE_ACCEPT } from '../../markdown/bundle'
import { MARKDOWN_ACCEPT } from '../../markdown/import'
import { CommentIcon, DownloadIcon, UploadIcon } from '../icons'

interface ExportMenuProps {
  onExport: () => void
  onExportAnnotated: () => void
  onImport: (file: File) => void
  disabled?: boolean
}

/**
 * Export and Import read as one file-transfer unit rather than two competing
 * buttons: a single shared border with a hairline divider between them.
 */
export function ExportMenu({
  onExport,
  onExportAnnotated,
  onImport,
  disabled,
}: ExportMenuProps) {
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div className="export-menu" role="group" aria-label="Document file actions">
      <button
        type="button"
        disabled={disabled}
        title="Download clean Markdown, bundled with an images folder when needed. Comments are never included."
        onClick={onExport}
      >
        <DownloadIcon width={14} height={14} />
        Export
      </button>

      {/* A separate file, not an option on the one above: the .md file's
          guarantee is that it carries no trace of the app, and comments in it
          would be exactly that trace. */}
      <button
        type="button"
        className="export-menu__annotated"
        disabled={disabled}
        aria-label="Export with comments"
        title="Download an .html copy with the comments alongside it"
        onClick={onExportAnnotated}
      >
        <CommentIcon width={14} height={14} />
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
