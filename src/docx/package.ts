import { zip, type AsyncZippable } from 'fflate'
import { element, textElement, xmlPart } from './xml'
import { Relationships, RELATIONSHIP_TYPES } from './rels'

/**
 * The OPC container: content types, package relationships, document
 * properties, and the ZIP itself.
 *
 * Nothing here knows what a paragraph is. `document.ts` produces the body and
 * the parts it references; this file wraps them in the envelope Word opens.
 */

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const WORDPROCESSING =
  'application/vnd.openxmlformats-officedocument.wordprocessingml'

const CONTENT_TYPES = {
  document: `${WORDPROCESSING}.document.main+xml`,
  styles: `${WORDPROCESSING}.styles+xml`,
  numbering: `${WORDPROCESSING}.numbering+xml`,
  comments: `${WORDPROCESSING}.comments+xml`,
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
} as const

/** Image extension → media type, for the `Default` entries. */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
}

export interface MediaPart {
  /** Path inside the package, e.g. `media/image1.png`, relative to `word/`. */
  path: string
  bytes: Uint8Array
}

export interface DocxParts {
  /** `word/document.xml`, already serialized. */
  document: string
  styles: string
  numbering: string
  /** Present only for the annotated export. */
  comments?: string
  /** Relationships owned by `word/document.xml`. */
  documentRels: Relationships
  media: readonly MediaPart[]
  title: string
}

function contentTypes(parts: DocxParts): string {
  const extensions = new Set<string>()
  for (const item of parts.media) {
    const extension = item.path.split('.').pop()?.toLowerCase()
    if (extension && IMAGE_CONTENT_TYPES[extension]) extensions.add(extension)
  }

  return xmlPart(
    element(
      'Types',
      { xmlns: 'http://schemas.openxmlformats.org/package/2006/content-types' },
      [
        element('Default', {
          Extension: 'rels',
          ContentType:
            'application/vnd.openxmlformats-package.relationships+xml',
        }),
        element('Default', { Extension: 'xml', ContentType: 'application/xml' }),
        ...[...extensions].map(extension =>
          element('Default', {
            Extension: extension,
            ContentType: IMAGE_CONTENT_TYPES[extension],
          }),
        ),
        element('Override', {
          PartName: '/word/document.xml',
          ContentType: CONTENT_TYPES.document,
        }),
        element('Override', {
          PartName: '/word/styles.xml',
          ContentType: CONTENT_TYPES.styles,
        }),
        element('Override', {
          PartName: '/word/numbering.xml',
          ContentType: CONTENT_TYPES.numbering,
        }),
        parts.comments
          ? element('Override', {
              PartName: '/word/comments.xml',
              ContentType: CONTENT_TYPES.comments,
            })
          : '',
        element('Override', {
          PartName: '/docProps/core.xml',
          ContentType: CONTENT_TYPES.core,
        }),
      ],
    ),
  )
}

function packageRels(): string {
  const rels = new Relationships()
  rels.add(RELATIONSHIP_TYPES.officeDocument, 'word/document.xml')
  rels.add(RELATIONSHIP_TYPES.coreProperties, 'docProps/core.xml')
  return rels.toXml()
}

/**
 * Title and timestamps only.
 *
 * No `Application`, no `Company`, no creator — `docProps/app.xml` is optional
 * and is therefore not written at all. The `.md` guarantee does not formally
 * extend to this format, but stamping the exporter's name into a file the user
 * is about to hand to someone else is not a thing to do merely because the
 * format permits it.
 */
function coreProperties(title: string, at: Date): string {
  const stamp = `${at.toISOString().slice(0, 19)}Z`
  const w3cdtf = { 'xsi:type': 'dcterms:W3CDTF' }

  return xmlPart(
    element(
      'cp:coreProperties',
      {
        'xmlns:cp':
          'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
        'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
        'xmlns:dcterms': 'http://purl.org/dc/terms/',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      },
      [
        textElement('dc:title', undefined, title),
        textElement('dcterms:created', w3cdtf, stamp),
        textElement('dcterms:modified', w3cdtf, stamp),
      ],
    ),
  )
}

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value)

/** Assemble every part into the map fflate zips. */
export function collectDocxFiles(
  parts: DocxParts,
  at: Date = new Date(),
): AsyncZippable {
  const files: AsyncZippable = {
    '[Content_Types].xml': utf8(contentTypes(parts)),
    '_rels/.rels': utf8(packageRels()),
    'docProps/core.xml': utf8(coreProperties(parts.title, at)),
    'word/document.xml': utf8(parts.document),
    'word/_rels/document.xml.rels': utf8(parts.documentRels.toXml()),
    'word/styles.xml': utf8(parts.styles),
    'word/numbering.xml': utf8(parts.numbering),
  }

  if (parts.comments) files['word/comments.xml'] = utf8(parts.comments)
  for (const item of parts.media) files[`word/${item.path}`] = item.bytes

  return files
}

export function zipDocx(files: AsyncZippable): Promise<Blob> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => {
      if (error) reject(error)
      // A fresh copy, because fflate may hand back a view onto a pooled
      // buffer it goes on to reuse.
      else resolve(new Blob([data.slice()], { type: DOCX_MIME }))
    })
  })
}
