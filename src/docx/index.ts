import type { Editor, JSONContent } from '@tiptap/core'
import { getDocumentAsset } from '../db/assets'
import { safeStem } from '../lib/filename'
import { collectLocalImageReferences } from '../markdown/bundle'
import { normalizeDocForExport } from '../markdown/export'
import type { ThreadWithComments } from '../types'
import { buildComments, CommentRegistry } from './comments'
import { buildDocument, createRenderContext } from './document'
import { MediaRegistry, prepareImage, type ImagePreparer, type PreparedImage } from './media'
import { buildNumbering } from './numbering'
import { collectDocxFiles, zipDocx } from './package'
import { RELATIONSHIP_TYPES } from './rels'
import { buildStyles } from './styles'

/**
 * `.docx` export.
 *
 * A third format alongside the `.md` and the annotated `.html`, and — like the
 * HTML — a deliberately separate file rather than an option on the markdown
 * path. The `.md` guarantee is that the file carries no trace of the app; Word
 * documents are structurally incapable of that promise, so they are not asked
 * to make it.
 *
 * The clean export drops comment marks the same way the markdown serializer
 * does: by giving them nowhere to go. Passing no `threads` leaves the render
 * context's comment registry null, and the walker then has nothing to emit.
 */

export interface DocxExport {
  blob: Blob
  filename: string
  /** Whether any comment threads were written into the file. */
  annotated: boolean
}

export interface DocxExportOptions {
  docId: string
  title: string
  /** Supply to produce the annotated variant; omit for the clean one. */
  threads?: readonly ThreadWithComments[]
  /** Overridden in tests, where no canvas exists. */
  prepare?: ImagePreparer
}

/**
 * Every local image, decoded and re-encoded up front.
 *
 * The document walk is synchronous — it has to be, to keep the numbering and
 * comment registries in document order without threading promises through
 * every branch — so the asynchronous part happens here, before it starts.
 */
async function prepareImages(
  doc: JSONContent,
  docId: string,
  prepare: ImagePreparer,
): Promise<Map<string, PreparedImage>> {
  const prepared = new Map<string, PreparedImage>()

  for (const reference of collectLocalImageReferences(doc)) {
    const asset = await getDocumentAsset(docId, reference.assetId)
    if (!asset) {
      throw new Error('A referenced image is missing from browser storage')
    }
    prepared.set(
      reference.assetId,
      await prepare(asset.blob, asset.mimeType, asset.originalName),
    )
  }

  return prepared
}

export async function buildDocxExport(
  editor: Editor,
  options: DocxExportOptions,
): Promise<DocxExport> {
  const { docId, title, threads, prepare = prepareImage } = options

  const doc = normalizeDocForExport(editor.getJSON())
  const images = await prepareImages(doc, docId, prepare)

  const media = new MediaRegistry()
  const context = createRenderContext({
    media,
    images,
    comments: threads ? new CommentRegistry(threads) : null,
  })

  // Ahead of the body, so the two parts every document needs hold the lowest
  // ids and the body's hyperlinks and images follow them.
  context.rels.add(RELATIONSHIP_TYPES.styles, 'styles.xml')
  context.rels.add(RELATIONSHIP_TYPES.numbering, 'numbering.xml')
  if (threads) context.rels.add(RELATIONSHIP_TYPES.comments, 'comments.xml')

  // Allocates numbering instances, media parts, hyperlink relationships and
  // comment ids as it walks, so it must run before any of them are serialized.
  const document = buildDocument(doc, context)
  const entries = context.comments?.entries ?? []

  const files = collectDocxFiles({
    document,
    styles: buildStyles(),
    numbering: buildNumbering(context.numbering.instances),
    comments: threads ? buildComments(entries) : undefined,
    documentRels: context.rels,
    media: media.media,
    title,
  })

  return {
    blob: await zipDocx(files),
    filename: `${safeStem(title)}${threads ? '-comments' : ''}.docx`,
    annotated: entries.length > 0,
  }
}
