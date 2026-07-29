import { useCallback, useEffect, useState } from 'react'

export const DOCUMENT_FONT_KEY = 'mertz-md:document-font'

export const documentFonts = [
  {
    id: 'system',
    label: 'System default',
    family: "system-ui, 'Segoe UI', Roboto, sans-serif",
  },
  {
    id: 'inter',
    label: 'Inter',
    family: "'Inter Variable', system-ui, sans-serif",
  },
  {
    id: 'fira-sans',
    label: 'Fira Sans',
    family: "'Fira Sans', system-ui, sans-serif",
  },
  {
    id: 'literata',
    label: 'Literata',
    family: "'Literata Variable', Georgia, serif",
  },
  {
    id: 'gfs-neohellenic',
    label: 'GFS Neohellenic',
    family: "'GFS Neohellenic', Georgia, serif",
  },
] as const

export type DocumentFontId = (typeof documentFonts)[number]['id']

export function isDocumentFontId(value: string | null): value is DocumentFontId {
  return documentFonts.some(font => font.id === value)
}

function storedFont(): DocumentFontId {
  const value = localStorage.getItem(DOCUMENT_FONT_KEY)
  return isDocumentFontId(value) ? value : 'system'
}

/** A global reading preference: document content only, never the app chrome. */
export function useDocumentFont() {
  const [font, setFont] = useState<DocumentFontId>(storedFont)

  useEffect(() => {
    document.documentElement.dataset.documentFont = font
  }, [font])

  const selectFont = useCallback((next: DocumentFontId) => {
    localStorage.setItem(DOCUMENT_FONT_KEY, next)
    setFont(next)
  }, [])

  return { font, selectFont }
}
