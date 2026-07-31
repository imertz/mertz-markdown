import { useCallback, useEffect, useState } from 'react'

export const DOCUMENT_TEXT_SIZE_KEY = 'mertz-md:document-text-size'

export const documentTextSizes = [
  { id: 'small', label: 'Small', scale: 0.9 },
  { id: 'default', label: 'Comfortable', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.15 },
  { id: 'extra-large', label: 'Extra large', scale: 1.3 },
] as const

export type DocumentTextSizeId = (typeof documentTextSizes)[number]['id']

export function isDocumentTextSizeId(
  value: string | null,
): value is DocumentTextSizeId {
  return documentTextSizes.some(size => size.id === value)
}

function storedTextSize(): DocumentTextSizeId {
  const value = localStorage.getItem(DOCUMENT_TEXT_SIZE_KEY)
  return isDocumentTextSizeId(value) ? value : 'default'
}

/** A global reading preference: scale document content, never the app chrome. */
export function useDocumentTextSize() {
  const [size, setSize] = useState<DocumentTextSizeId>(storedTextSize)

  useEffect(() => {
    document.documentElement.dataset.documentTextSize = size
  }, [size])

  const selectSize = useCallback((next: DocumentTextSizeId) => {
    localStorage.setItem(DOCUMENT_TEXT_SIZE_KEY, next)
    setSize(next)
  }, [])

  return { size, selectSize }
}
