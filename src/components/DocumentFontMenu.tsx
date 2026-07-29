import { useCallback, useState } from 'react'
import {
  documentFonts,
  type DocumentFontId,
} from '../hooks/useDocumentFont'
import { useDismissable } from '../hooks/useDismissable'
import { CheckIcon } from './icons'

interface DocumentFontMenuProps {
  font: DocumentFontId
  onSelect: (font: DocumentFontId) => void
}

export function DocumentFontMenu({ font, onSelect }: DocumentFontMenuProps) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const container = useDismissable<HTMLDivElement>(open, close)
  const current = documentFonts.find(option => option.id === font)

  return (
    <div className="font-menu" ref={container}>
      <button
        type="button"
        className="font-menu__trigger"
        aria-label={`Reading font: ${current?.label ?? 'System default'}`}
        title="Reading font"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(value => !value)}
      >
        <span className="font-menu__glyph" aria-hidden="true">
          Aa
        </span>
      </button>

      {open ? (
        <div className="font-menu__panel" role="menu" aria-label="Reading font">
          {documentFonts.map(option => {
            const selected = option.id === font
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                aria-current={selected ? 'true' : undefined}
                className="font-menu__option"
                style={{ fontFamily: option.family }}
                onClick={() => {
                  onSelect(option.id)
                  close()
                }}
              >
                <span className="font-menu__option-copy">
                  <span className="font-menu__option-name">{option.label}</span>
                  <span className="font-menu__option-preview">
                    Καλημέρα · Greek notes
                  </span>
                </span>
                {selected ? <CheckIcon className="font-menu__check" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
