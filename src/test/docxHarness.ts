import type { Editor } from '@tiptap/core'
import { strFromU8, unzipSync } from 'fflate'
import { buildDocxExport, type DocxExportOptions } from '../docx'
import type { ImagePreparer } from '../docx/media'

/**
 * A `.docx` unpacked back into its parts.
 *
 * Reading the ZIP rather than the builders' return values is deliberate: what
 * Word opens is the archive, so an assertion about a part is only worth making
 * against the bytes that actually shipped.
 */
export interface UnpackedDocx {
  filename: string
  annotated: boolean
  parts: Record<string, Uint8Array>
  /** A part's contents as text. Throws when the part is absent. */
  text: (path: string) => string
}

/**
 * Stands in for the canvas. happy-dom has neither `createImageBitmap` nor a
 * 2D context, so the real `prepareImage` cannot run in the suite at all.
 *
 * Returns a fixed size so dimension assertions have something exact to check,
 * and reports every input as PNG — which is also what the real preparer does
 * for the WebP the app stores by default.
 */
export const FAKE_IMAGE_SIZE = { width: 400, height: 200 } as const

export const stubPrepareImage: ImagePreparer = async (blob, mimeType) => ({
  bytes: new Uint8Array(await blob.arrayBuffer()),
  extension: mimeType === 'image/jpeg' ? 'jpg' : 'png',
  ...FAKE_IMAGE_SIZE,
})

export async function exportDocx(
  editor: Editor,
  options: Partial<DocxExportOptions> = {},
): Promise<UnpackedDocx> {
  const exported = await buildDocxExport(editor, {
    docId: 'doc-1',
    title: 'Notes',
    prepare: stubPrepareImage,
    ...options,
  })

  const parts = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()))

  return {
    filename: exported.filename,
    annotated: exported.annotated,
    parts,
    text: (path: string) => {
      const bytes = parts[path]
      if (!bytes) {
        throw new Error(
          `No such part: ${path}. Present: ${Object.keys(parts).join(', ')}`,
        )
      }
      return strFromU8(bytes)
    },
  }
}

/**
 * Every occurrence of an element, as its raw XML.
 *
 * A regex rather than a parse, because these assertions are about the bytes:
 * a DOM would happily normalize away exactly the malformation worth catching.
 */
export function elements(xml: string, name: string): string[] {
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</${name}>)`, 'g')
  return xml.match(pattern) ?? []
}

/** The value of one attribute on the first match of `name`. */
export function attribute(
  xml: string,
  name: string,
  attributeName: string,
): string | null {
  const [first] = elements(xml, name)
  if (!first) return null
  const match = first.match(new RegExp(`${attributeName}="([^"]*)"`))
  return match?.[1] ?? null
}

/** Plain text of the document body, with every run boundary collapsed. */
export function documentText(xml: string): string {
  return (xml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? [])
    .map(match => match.replace(/<[^>]+>/g, ''))
    .join('')
}
