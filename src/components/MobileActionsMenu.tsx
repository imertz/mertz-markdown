import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useDismissable } from '../hooks/useDismissable'
import {
  documentFonts,
  type DocumentFontId,
} from '../hooks/useDocumentFont'
import {
  documentTextSizes,
  type DocumentTextSizeId,
} from '../hooks/useDocumentTextSize'
import { hintFor } from '../keys/catalog'
import { BUNDLE_ACCEPT } from '../markdown/bundle'
import { MARKDOWN_ACCEPT } from '../markdown/import'
import type { Theme } from '../hooks/useTheme'
import { FORMATS, type ExportActions } from './documents/exportFormats'
import { CheckIcon, MoonIcon, MoreIcon, SunIcon } from './icons'

export interface MobileActionsMenuProps {
  exports: ExportActions
  onImport: (file: File) => void
  onOpenHistory: () => void
  onOpenExtensions?: () => void
  renderExtensionActions?: (close: () => void) => ReactNode
  font: DocumentFontId
  onSelectFont: (font: DocumentFontId) => void
  textSize: DocumentTextSizeId
  onSelectTextSize: (size: DocumentTextSizeId) => void
  theme: Theme
  onToggleTheme: () => void
  onOpenShortcuts: () => void
  disabled?: boolean
}

/**
 * Everything the header cannot hold on a phone, in one sheet.
 *
 * The desktop header carries eight controls in a row that measures 428px; a
 * 390px screen cannot show them, and the last of them — the theme toggle — was
 * simply clipped off the edge with no way to reach it. Rather than shrink the
 * row until it fits, the controls that are not glanceable move in here.
 *
 * Flat, not nested. Export, reading font and text size are menus of their own on
 * desktop, but a menu that opens a menu is miserable to operate with a thumb, so
 * their options are laid out as sections of one scrolling sheet. Each section
 * reads from the same array the desktop menu does, so the two cannot drift.
 */
export function MobileActionsMenu(props: MobileActionsMenuProps) {
  const {
    exports,
    onImport,
    onOpenHistory,
    onOpenExtensions,
    renderExtensionActions,
    font,
    onSelectFont,
    textSize,
    onSelectTextSize,
    theme,
    onToggleTheme,
    onOpenShortcuts,
    disabled,
  } = props

  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const container = useDismissable<HTMLDivElement>(open, close)
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div className="actions-menu" ref={container}>
      <button
        type="button"
        className="app-header__icon"
        aria-label="More actions"
        title="More actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(value => !value)}
      >
        <MoreIcon />
      </button>

      {open ? (
        <div className="actions-menu__panel" role="menu" aria-label="More actions">
          <p className="actions-menu__heading">Export</p>
          {FORMATS.map(format => (
            <button
              key={format.id}
              type="button"
              role="menuitem"
              className="actions-menu__option"
              disabled={disabled}
              onClick={() => {
                close()
                format.run(exports)
              }}
            >
              {format.label}
            </button>
          ))}

          <p className="actions-menu__heading">Document</p>
          <button
            type="button"
            role="menuitem"
            className="actions-menu__option"
            onClick={() => fileInput.current?.click()}
          >
            Import…
          </button>
          <button
            type="button"
            role="menuitem"
            className="actions-menu__option"
            disabled={disabled}
            onClick={() => {
              close()
              onOpenHistory()
            }}
          >
            Version history
          </button>
          {renderExtensionActions?.(close)}
          {onOpenExtensions ? (
            <button
              type="button"
              role="menuitem"
              className="actions-menu__option"
              onClick={() => {
                close()
                onOpenExtensions()
              }}
            >
              Extensions
            </button>
          ) : null}

          <p className="actions-menu__heading">Reading font</p>
          {documentFonts.map(option => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === font}
              className="actions-menu__option"
              style={{ fontFamily: option.family }}
              onClick={() => {
                onSelectFont(option.id)
                close()
              }}
            >
              {option.label}
              {option.id === font ? (
                <CheckIcon className="actions-menu__check" />
              ) : null}
            </button>
          ))}

          <p className="actions-menu__heading">Text size</p>
          {documentTextSizes.map(option => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === textSize}
              className="actions-menu__option"
              onClick={() => {
                onSelectTextSize(option.id)
                close()
              }}
            >
              {option.label}
              {option.id === textSize ? (
                <CheckIcon className="actions-menu__check" />
              ) : null}
            </button>
          ))}

          <p className="actions-menu__heading">Appearance</p>
          <button
            type="button"
            role="menuitem"
            className="actions-menu__option"
            onClick={() => {
              onToggleTheme()
              close()
            }}
          >
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            {theme === 'dark' ? (
              <SunIcon className="actions-menu__check" />
            ) : (
              <MoonIcon className="actions-menu__check" />
            )}
          </button>

          {/*
            Last, because it is the least reached for. Present at all because
            this sheet stands in for the whole header below 900px — which
            includes a tablet with a keyboard attached, where the chord is
            worth knowing and the status bar's chip is hidden.
          */}
          <p className="actions-menu__heading">Help</p>
          <button
            type="button"
            role="menuitem"
            className="actions-menu__option"
            onClick={() => {
              close()
              onOpenShortcuts()
            }}
          >
            Keyboard shortcuts
            <kbd className="kbd">{hintFor('app.cheatsheet')}</kbd>
          </button>
        </div>
      ) : null}

      {/* Kept outside the panel: the picker has to survive the sheet closing,
          which it does the moment the OS file dialog takes the tap. */}
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
          close()
          onImport(file)
        }}
      />
    </div>
  )
}
