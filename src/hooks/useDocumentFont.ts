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
  {
    id: 'source-sans-3',
    label: 'Source Sans 3',
    family: "'Source Sans 3 Variable', system-ui, sans-serif",
  },
  {
    id: 'eb-garamond',
    label: 'EB Garamond',
    family: "'EB Garamond Variable', Georgia, serif",
  },
  {
    id: 'alegreya',
    label: 'Alegreya',
    family: "'Alegreya Variable', Georgia, serif",
  },
  {
    /*
     * The only fixed-pitch option. Its fallbacks stay monospaced so polytonic
     * Greek — the one range this family does not draw — lands on another
     * fixed-pitch face rather than breaking the column's rhythm.
     */
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: "'JetBrains Mono Variable', ui-monospace, Consolas, monospace",
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
