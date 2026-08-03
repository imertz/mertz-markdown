import { useCallback, useState } from 'react'
import {
  documentTextSizes,
  type DocumentTextSizeId,
} from '../hooks/useDocumentTextSize'
import { useDismissable } from '../hooks/useDismissable'
import { CheckIcon, TextSizeArrowsIcon } from './icons'

interface DocumentTextSizeMenuProps {
  size: DocumentTextSizeId
  onSelect: (size: DocumentTextSizeId) => void
}

export function DocumentTextSizeMenu({
  size,
  onSelect,
}: DocumentTextSizeMenuProps) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const container = useDismissable<HTMLDivElement>(open, close)
  const current = documentTextSizes.find(option => option.id === size)

  return (
    <div className="text-size-menu" ref={container}>
      <button
        type="button"
        className="text-size-menu__trigger"
        aria-label={`Text size: ${current?.label ?? 'Comfortable'}`}
        title="Adjust document text size"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(value => !value)}
      >
        <span className="text-size-menu__glyph" aria-hidden="true">
          A
          <TextSizeArrowsIcon />
        </span>
      </button>

      {open ? (
        <div
          className="text-size-menu__panel"
          role="menu"
          aria-label="Document text size"
        >
          <div className="text-size-menu__heading">
            <span>Text size</span>
            <span>{current?.label ?? 'Comfortable'}</span>
          </div>
          {documentTextSizes.map(option => {
            const selected = option.id === size
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                aria-current={selected ? 'true' : undefined}
                className="text-size-menu__option"
                onClick={() => {
                  onSelect(option.id)
                  close()
                }}
              >
                <span
                  className="text-size-menu__preview"
                  data-size={option.id}
                  aria-hidden="true"
                >
                  Aa
                </span>
                <span className="text-size-menu__option-copy">
                  <span className="text-size-menu__option-name">
                    {option.label}
                  </span>
                  <span className="text-size-menu__option-hint">
                    {Math.round(option.scale * 100)}% reading scale
                  </span>
                </span>
                {selected ? <CheckIcon className="text-size-menu__check" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
