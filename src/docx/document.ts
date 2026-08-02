import type { JSONContent } from '@tiptap/core'
import { COMMENT_MARK_NAME } from '../editor/extensions/comment'
import { commentRangeEnd, commentRangeStart, type CommentRegistry } from './comments'
import type { MediaRegistry, PreparedImage } from './media'
import { NumberingRegistry } from './numbering'
import { Relationships, RELATIONSHIP_TYPES } from './rels'
import { STYLE_IDS } from './styles'
import {
  CONTENT_WIDTH_EMU,
  CONTENT_WIDTH_TWIPS,
  emuFromPixels,
  fitWithin,
  PAGE,
  twipsFromInches,
  twipsFromPixels,
} from './units'
import { element, textElement, xmlPart } from './xml'

/**
 * ProseMirror JSON → `word/document.xml`.
 *
 * Every node and mark in the schema is accounted for in the two tables below,
 * and `src/test/docx-lock.test.ts` fails the build if one is not. That guard
 * exists for the same reason `schema-lock.test.ts` does: a walker that meets a
 * node it has no case for emits nothing, and a node silently missing from the
 * exported file is data loss rather than lost formatting.
 */

/** How a node reaches the output. */
export type NodeHandling =
  /** The document itself. */
  | 'root'
  /** Produces one or more block-level elements. */
  | 'block'
  /** Produces runs inside a block. */
  | 'inline'
  /** Emitted by an ancestor, which owns the context it needs. */
  | 'parent'

export const NODE_HANDLING: Record<string, NodeHandling> = {
  doc: 'root',

  paragraph: 'block',
  heading: 'block',
  blockquote: 'block',
  bulletList: 'block',
  orderedList: 'block',
  taskList: 'block',
  codeBlock: 'block',
  horizontalRule: 'block',
  table: 'block',

  // A list item needs its parent's numbering instance and depth; a table cell
  // needs the grid it sits in. Both are rendered by the ancestor that has them.
  listItem: 'parent',
  taskItem: 'parent',
  tableRow: 'parent',
  tableHeader: 'parent',
  tableCell: 'parent',

  text: 'inline',
  hardBreak: 'inline',
  image: 'inline',
}

/** How a mark reaches the output. */
export type MarkHandling =
  /** Contributes to the run's `w:rPr`. */
  | 'runProperty'
  /** Wraps the run in another element. */
  | 'wrapper'
  /** Deliberately produces nothing. */
  | 'invisible'

export const MARK_HANDLING: Record<string, MarkHandling> = {
  bold: 'runProperty',
  italic: 'runProperty',
  strike: 'runProperty',
  code: 'runProperty',
  link: 'wrapper',
  // Not an oversight, and not the same as being unhandled: the clean export
  // carries no trace of a comment, and the annotated one expresses it as a
  // range around the run rather than as a property of it.
  comment: 'invisible',
}

const RUN_PROPERTIES: Record<string, string> = {
  bold: element('w:b'),
  italic: element('w:i'),
  strike: element('w:strike'),
  code: element('w:rStyle', { 'w:val': STYLE_IDS.codeSpan }),
}

export interface RenderContext {
  numbering: NumberingRegistry
  media: MediaRegistry
  rels: Relationships
  /** Null for the clean export, which is what makes comments invisible there. */
  comments: CommentRegistry | null
  /** Resolved ahead of the walk, because the walk itself is synchronous. */
  images: ReadonlyMap<string, PreparedImage>
  /** Deduplicates hyperlink relationships by target. */
  hyperlinks: Map<string, string>
  /** `wp:docPr` ids must be unique across the document and start at 1. */
  nextDrawingId: number
}

export function createRenderContext(
  overrides: Partial<RenderContext> & Pick<RenderContext, 'media'>,
): RenderContext {
  return {
    numbering: new NumberingRegistry(),
    rels: new Relationships(),
    comments: null,
    images: new Map(),
    hyperlinks: new Map(),
    nextDrawingId: 1,
    ...overrides,
  }
}

// ─── Blocks ────────────────────────────────────────────────────────────────

type Alignment = 'left' | 'center' | 'right' | 'justify'

interface BlockOptions {
  /** Numbering to attach, when this block opens a list item. */
  list?: { numId: number; level: number }
  /** Left indent in twips, on top of anything the style carries. */
  indent?: number
  /** Forced alignment, used by table cells to apply their column's. */
  align?: Alignment
  /** Paragraph style id. */
  style?: string
}

const JUSTIFICATION: Record<Alignment, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'both',
}

function paragraphProperties(options: BlockOptions): string {
  const parts = [
    options.style ? element('w:pStyle', { 'w:val': options.style }) : '',
    options.list
      ? element('w:numPr', undefined, [
          element('w:ilvl', { 'w:val': options.list.level }),
          element('w:numId', { 'w:val': options.list.numId }),
        ])
      : '',
    options.indent ? element('w:ind', { 'w:left': options.indent }) : '',
    options.align
      ? element('w:jc', { 'w:val': JUSTIFICATION[options.align] })
      : '',
  ].join('')

  return parts ? element('w:pPr', undefined, parts) : ''
}

const paragraphElement = (options: BlockOptions, inline: string): string =>
  element('w:p', undefined, paragraphProperties(options) + inline)

const imageCaption = (node: JSONContent): string =>
  node.type === 'image' && typeof node.attrs?.title === 'string'
    ? node.attrs.title.trim()
    : ''

function captionsAfterParagraph(
  nodes: readonly JSONContent[],
  context: RenderContext,
  options: BlockOptions,
): string {
  return nodes
    .map(imageCaption)
    .filter(Boolean)
    .map(caption =>
      paragraphElement(
        { ...options, style: STYLE_IDS.caption },
        renderTextRun({ type: 'text', text: caption }, context),
      ),
    )
    .join('')
}

/** Every block a node produces, in order. */
function renderBlock(
  node: JSONContent,
  context: RenderContext,
  options: BlockOptions = {},
): string {
  switch (node.type) {
    case 'paragraph': {
      const paragraphOptions = {
        ...options,
        // A cell's column alignment wins over nothing; an explicitly
        // justified paragraph wins over the cell.
        align: node.attrs?.textAlign === 'justify' ? 'justify' : options.align,
      }
      const content = node.content ?? []
      return (
        paragraphElement(paragraphOptions, renderInline(content, context)) +
        captionsAfterParagraph(content, context, paragraphOptions)
      )
    }

    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
      return paragraphElement(
        { ...options, style: STYLE_IDS.heading(level) },
        renderInline(node.content ?? [], context),
      )
    }

    case 'blockquote':
      return (node.content ?? [])
        .map(child =>
          renderBlock(child, context, {
            ...options,
            // The style carries the rule and the indent; nested quotes add to
            // it, which is what makes the second level read as deeper.
            style: child.type === 'paragraph' ? STYLE_IDS.quote : options.style,
            indent: (options.indent ?? 0) + twipsFromInches(0.25),
          }),
        )
        .join('')

    case 'bulletList':
    case 'orderedList':
      return renderList(node, context, options)

    case 'taskList':
      return renderTaskList(node, context, options, 0)

    case 'codeBlock':
      return renderCodeBlock(node, options)

    case 'horizontalRule':
      // A paragraph whose only content is a bottom border. Word has no rule
      // element; this is what its own UI inserts.
      return element(
        'w:p',
        undefined,
        element(
          'w:pPr',
          undefined,
          element(
            'w:pBdr',
            undefined,
            element('w:bottom', {
              'w:val': 'single',
              'w:sz': 6,
              'w:space': 1,
              'w:color': 'D9D4CA',
            }),
          ),
        ),
      )

    case 'table':
      return renderTable(node, context, options)

    default:
      // Unreachable while docx-lock.test.ts passes.
      return ''
  }
}

function renderBlocks(
  nodes: readonly JSONContent[],
  context: RenderContext,
  options: BlockOptions = {},
): string {
  return nodes.map(node => renderBlock(node, context, options)).join('')
}

// ─── Lists ─────────────────────────────────────────────────────────────────

/**
 * One numbering instance per list node, nested lists included.
 *
 * Reusing the parent's instance for a nested list looks tempting and is wrong:
 * an `abstractNum` fixes the format of every level up front, so a bulleted list
 * inside a numbered one would be drawn with the *numbered* definition's level-1
 * format and come out as "a. b. c.". The two kinds cannot share a definition,
 * so they do not share an instance.
 *
 * Allocating per node also gets the restart behaviour for free: sibling ordered
 * lists count separately, and so does each nested one.
 *
 * `options.list` is still threaded down, but only for its depth.
 */
function renderList(
  node: JSONContent,
  context: RenderContext,
  options: BlockOptions,
): string {
  const kind = node.type === 'orderedList' ? 'ordered' : 'bullet'
  const level = options.list ? options.list.level + 1 : 0
  const numId = context.numbering.allocate(
    kind,
    Number(node.attrs?.start) || 1,
  )

  return (node.content ?? [])
    .map(item => renderListItem(item, context, options, { numId, level }))
    .join('')
}

function renderListItem(
  item: JSONContent,
  context: RenderContext,
  options: BlockOptions,
  list: { numId: number; level: number },
): string {
  const children = item.content ?? []

  return children
    .map((child, index) =>
      renderBlock(child, context, {
        ...options,
        style: STYLE_IDS.listParagraph,
        // Only the first block carries the bullet. A second paragraph in the
        // same item is a continuation, not a new item.
        list: index === 0 && child.type === 'paragraph' ? list : undefined,
        // A nested list keeps the numbering it inherits so renderList can see
        // it is nested and step the level rather than allocate afresh.
        ...(child.type === 'bulletList' ||
        child.type === 'orderedList' ||
        child.type === 'taskList'
          ? { list }
          : {}),
      }),
    )
    .join('')
}

/** U+2610 BALLOT BOX and U+2612 BALLOT BOX WITH X. */
const CHECKBOX = { unchecked: '☐', checked: '☒' } as const

/**
 * Task items as an indented paragraph with a box glyph.
 *
 * Word's real checkbox is a content control — a `w:sdt` carrying a
 * `w14:checkbox`, plus a matching entry in the settings part — which buys an
 * interactive tick in exchange for markup the rest of this exporter has no use
 * for. A glyph prints identically and survives every reader.
 */
function renderTaskList(
  node: JSONContent,
  context: RenderContext,
  options: BlockOptions,
  level: number,
): string {
  return (node.content ?? [])
    .map(item => {
      const checked = item.attrs?.checked === true
      const glyph = checked ? CHECKBOX.checked : CHECKBOX.unchecked
      const indent = (options.indent ?? 0) + twipsFromInches(0.25 * (level + 1))

      return (item.content ?? [])
        .map((child, index) => {
          if (child.type === 'taskList') {
            return renderTaskList(child, context, options, level + 1)
          }
          if (child.type !== 'paragraph') {
            return renderBlock(child, context, { ...options, indent })
          }

          const marker =
            index === 0
              ? element('w:r', undefined, [
                  element(
                    'w:rPr',
                    undefined,
                    element('w:rFonts', {
                      'w:ascii': 'Segoe UI Symbol',
                      'w:hAnsi': 'Segoe UI Symbol',
                    }),
                  ),
                  textElement('w:t', { 'xml:space': 'preserve' }, `${glyph} `),
                ])
              : ''

          return paragraphElement(
            { ...options, indent },
            marker + renderInline(child.content ?? [], context),
          )
        })
        .join('')
    })
    .join('')
}

// ─── Code ──────────────────────────────────────────────────────────────────

/**
 * One paragraph, lines joined by breaks, so the shading and border draw a
 * single box rather than one per line.
 *
 * The `language` attribute is dropped: Word has no concept of a fenced
 * language, and the highlighting the editor shows is decorations that never
 * entered the document in the first place.
 */
function renderCodeBlock(node: JSONContent, options: BlockOptions): string {
  const source = (node.content ?? [])
    .map(child => (typeof child.text === 'string' ? child.text : ''))
    .join('')

  const lines = source.split('\n')
  const runs = lines
    .map((line, index) => {
      const parts = [
        index > 0 ? element('w:br') : '',
        line ? textElement('w:t', { 'xml:space': 'preserve' }, line) : '',
      ].join('')
      return parts ? element('w:r', undefined, parts) : ''
    })
    .join('')

  return paragraphElement({ ...options, style: STYLE_IDS.codeBlock }, runs)
}

// ─── Tables ────────────────────────────────────────────────────────────────

const CELL_BORDER = 'E6E2DA'
const HEADER_FILL = 'F2EFE9'

const isHeaderCell = (node: JSONContent): boolean =>
  node.type === 'tableHeader'

/**
 * The column grid, taken from the widest row.
 *
 * `colwidth` is per-cell and in CSS pixels, and is null until the user drags a
 * column, so most tables fall through to an even split of the text column.
 */
function tableGrid(rows: readonly JSONContent[]): number[] {
  const widths: number[] = []

  for (const row of rows) {
    let column = 0
    for (const cell of row.content ?? []) {
      const span = Math.max(1, Number(cell.attrs?.colspan) || 1)
      const declared = Array.isArray(cell.attrs?.colwidth)
        ? (cell.attrs.colwidth as (number | null)[])
        : []
      for (let index = 0; index < span; index += 1) {
        const pixels = declared[index]
        const value =
          typeof pixels === 'number' && pixels > 0
            ? twipsFromPixels(pixels)
            : undefined
        if (value !== undefined) widths[column] = value
        else if (widths[column] === undefined) widths[column] = 0
        column += 1
      }
    }
  }

  if (!widths.length) return []

  // Columns nobody sized share whatever the sized ones left over.
  const sized = widths.filter(width => width > 0)
  const remaining = Math.max(
    0,
    CONTENT_WIDTH_TWIPS - sized.reduce((total, width) => total + width, 0),
  )
  const unsized = widths.length - sized.length
  const share = unsized > 0 ? Math.floor(remaining / unsized) : 0
  const even = Math.floor(CONTENT_WIDTH_TWIPS / widths.length)

  return widths.map(width =>
    width > 0 ? width : share > 0 ? share : even,
  )
}

function renderTable(
  node: JSONContent,
  context: RenderContext,
  options: BlockOptions,
): string {
  const rows = node.content ?? []
  const grid = tableGrid(rows)

  const borders = element(
    'w:tblBorders',
    undefined,
    (['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const)
      .map(edge =>
        element(`w:${edge}`, {
          'w:val': 'single',
          'w:sz': 4,
          'w:space': 0,
          'w:color': CELL_BORDER,
        }),
      )
      .join(''),
  )

  const properties = element('w:tblPr', undefined, [
    element('w:tblW', { 'w:w': 5000, 'w:type': 'pct' }),
    borders,
    element('w:tblLayout', { 'w:type': 'fixed' }),
  ])

  const columns = element(
    'w:tblGrid',
    undefined,
    grid.map(width => element('w:gridCol', { 'w:w': width })),
  )

  const body = rows
    .map(row => renderTableRow(row, context, options))
    .join('')

  return element('w:tbl', undefined, properties + columns + body)
}

function renderTableRow(
  row: JSONContent,
  context: RenderContext,
  options: BlockOptions,
): string {
  const cells = row.content ?? []
  const heading = cells.length > 0 && cells.every(isHeaderCell)

  const properties = heading
    ? element('w:trPr', undefined, element('w:tblHeader'))
    : ''

  return element(
    'w:tr',
    undefined,
    properties + cells.map(cell => renderTableCell(cell, context, options)).join(''),
  )
}

function renderTableCell(
  cell: JSONContent,
  context: RenderContext,
  options: BlockOptions,
): string {
  const colspan = Math.max(1, Number(cell.attrs?.colspan) || 1)
  const rowspan = Math.max(1, Number(cell.attrs?.rowspan) || 1)
  const align = cell.attrs?.align
  const heading = isHeaderCell(cell)

  const properties = element('w:tcPr', undefined, [
    element('w:tcW', { 'w:w': 0, 'w:type': 'auto' }),
    colspan > 1 ? element('w:gridSpan', { 'w:val': colspan }) : '',
    // The table UI cannot create these and GFM cannot express them, so this is
    // reachable only through a pasted HTML table. ProseMirror stores no
    // continuation cells for a span, so the rows below stay short — starting
    // the merge is still closer to the intent than ignoring it.
    rowspan > 1 ? element('w:vMerge', { 'w:val': 'restart' }) : '',
    heading
      ? element('w:shd', {
          'w:val': 'clear',
          'w:color': 'auto',
          'w:fill': HEADER_FILL,
        })
      : '',
  ])

  const cellOptions: BlockOptions = {
    ...options,
    // A cell resets the surrounding indent; its own box is the boundary.
    indent: undefined,
    // A paragraph style's run properties reach the runs inside it, so this is
    // what makes a header row bold without touching every text node.
    style: heading ? STYLE_IDS.tableHeader : undefined,
    align:
      align === 'left' || align === 'center' || align === 'right'
        ? align
        : undefined,
  }

  const content = (cell.content ?? []).map(child =>
    renderBlock(child, context, cellOptions),
  )

  // A cell with no paragraph at all makes the file invalid.
  const blocks = content.join('') || element('w:p')

  return element('w:tc', undefined, properties + blocks)
}

// ─── Inline ────────────────────────────────────────────────────────────────

const threadIdsOf = (node: JSONContent): string[] => {
  const ids: string[] = []
  for (const mark of node.marks ?? []) {
    if (mark.type !== COMMENT_MARK_NAME) continue
    const threadId = mark.attrs?.threadId
    if (typeof threadId === 'string' && threadId) ids.push(threadId)
  }
  return ids
}

/**
 * A run of inline nodes, with comment ranges opened and closed around them.
 *
 * Applying a comment mark splits the text node it covers, so one thread
 * routinely arrives as several adjacent nodes. Tracking which ids are open and
 * only emitting a boundary when the set changes is what collapses those back
 * into the single range the user drew.
 */
function renderInline(
  nodes: readonly JSONContent[],
  context: RenderContext,
): string {
  const registry = context.comments
  let out = ''
  let open: number[] = []

  const close = (keep: ReadonlySet<number>) => {
    const staying: number[] = []
    for (const id of open) {
      if (keep.has(id)) staying.push(id)
      else out += commentRangeEnd(id)
    }
    open = staying
  }

  for (const node of nodes) {
    const wanted = registry
      ? threadIdsOf(node)
          .map(threadId => registry.idFor(threadId))
          .filter((id): id is number => id !== null)
      : []

    const wantedSet = new Set(wanted)
    close(wantedSet)
    for (const id of wanted) {
      if (!open.includes(id)) {
        out += commentRangeStart(id)
        open.push(id)
      }
    }

    out += renderInlineNode(node, context)
  }

  close(new Set())
  return out
}

function renderInlineNode(node: JSONContent, context: RenderContext): string {
  switch (node.type) {
    case 'text':
      return renderTextRun(node, context)
    case 'hardBreak':
      return element('w:r', undefined, element('w:br'))
    case 'image':
      return renderImage(node, context)
    default:
      return ''
  }
}

function runProperties(node: JSONContent): string {
  const parts = (node.marks ?? [])
    .map(mark => RUN_PROPERTIES[mark.type ?? ''] ?? '')
    .join('')
  return parts ? element('w:rPr', undefined, parts) : ''
}

function linkHref(node: JSONContent): string | null {
  for (const mark of node.marks ?? []) {
    if (mark.type !== 'link') continue
    const href = mark.attrs?.href
    if (typeof href === 'string' && href) return href
  }
  return null
}

function hyperlinkId(href: string, context: RenderContext): string {
  const existing = context.hyperlinks.get(href)
  if (existing) return existing
  const id = context.rels.add(RELATIONSHIP_TYPES.hyperlink, href, true)
  context.hyperlinks.set(href, id)
  return id
}

function renderTextRun(node: JSONContent, context: RenderContext): string {
  const text = typeof node.text === 'string' ? node.text : ''
  if (!text) return ''

  const href = linkHref(node)
  const properties = href
    ? element(
        'w:rPr',
        undefined,
        element('w:rStyle', { 'w:val': STYLE_IDS.hyperlink }) +
          (node.marks ?? [])
            .map(mark => RUN_PROPERTIES[mark.type ?? ''] ?? '')
            .join(''),
      )
    : runProperties(node)

  const run = element(
    'w:r',
    undefined,
    properties + textElement('w:t', { 'xml:space': 'preserve' }, text),
  )

  return href
    ? element('w:hyperlink', { 'r:id': hyperlinkId(href, context) }, run)
    : run
}

const DRAWING_NAMESPACES = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
} as const

function renderImage(node: JSONContent, context: RenderContext): string {
  const assetId =
    typeof node.attrs?.assetId === 'string' ? node.attrs.assetId : ''
  const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
  const prepared = assetId ? context.images.get(assetId) : undefined

  if (!prepared) {
    // A remote image has no bytes in browser storage, and fetching one at
    // export time would need the host's CORS permission and a network the
    // rest of this path does not require. The link keeps it reachable.
    if (!src) return ''
    return element(
      'w:hyperlink',
      { 'r:id': hyperlinkId(src, context) },
      element(
        'w:r',
        undefined,
        element(
          'w:rPr',
          undefined,
          element('w:rStyle', { 'w:val': STYLE_IDS.hyperlink }),
        ) + textElement('w:t', { 'xml:space': 'preserve' }, alt || src),
      ),
    )
  }

  const path = context.media.add(assetId, prepared)
  const embedId = context.rels.add(RELATIONSHIP_TYPES.image, path)

  const declaredWidth = Number(node.attrs?.width)
  const declaredHeight = Number(node.attrs?.height)
  const width =
    Number.isFinite(declaredWidth) && declaredWidth > 0
      ? declaredWidth
      : prepared.width
  // Only trust a declared height alongside a declared width; otherwise scale
  // the intrinsic ratio to whatever width was asked for.
  const height =
    Number.isFinite(declaredHeight) && declaredHeight > 0
      ? declaredHeight
      : Math.max(1, Math.round((prepared.height / prepared.width) * width))

  const extent = fitWithin(
    { width: emuFromPixels(width), height: emuFromPixels(height) },
    CONTENT_WIDTH_EMU,
  )

  const id = context.nextDrawingId
  context.nextDrawingId += 1
  const name = `Picture ${id}`

  const blipFill = element('pic:blipFill', undefined, [
    element('a:blip', { 'r:embed': embedId }),
    element('a:stretch', undefined, element('a:fillRect')),
  ])

  const shape = element('pic:spPr', undefined, [
    element('a:xfrm', undefined, [
      element('a:off', { x: 0, y: 0 }),
      element('a:ext', { cx: extent.width, cy: extent.height }),
    ]),
    element('a:prstGeom', { prst: 'rect' }, element('a:avLst')),
  ])

  const picture = element(
    'pic:pic',
    { 'xmlns:pic': DRAWING_NAMESPACES.pic },
    [
      element('pic:nvPicPr', undefined, [
        element('pic:cNvPr', { id, name, descr: alt || undefined }),
        element('pic:cNvPicPr'),
      ]),
      blipFill,
      shape,
    ],
  )

  const graphic = element(
    'a:graphic',
    { 'xmlns:a': DRAWING_NAMESPACES.a },
    element(
      'a:graphicData',
      { uri: DRAWING_NAMESPACES.pic },
      picture,
    ),
  )

  const inline = element(
    'wp:inline',
    { distT: 0, distB: 0, distL: 0, distR: 0 },
    [
      element('wp:extent', { cx: extent.width, cy: extent.height }),
      element('wp:effectExtent', { l: 0, t: 0, r: 0, b: 0 }),
      element('wp:docPr', { id, name, descr: alt || undefined }),
      element(
        'wp:cNvGraphicFramePr',
        undefined,
        element('a:graphicFrameLocks', {
          'xmlns:a': DRAWING_NAMESPACES.a,
          noChangeAspect: 1,
        }),
      ),
      graphic,
    ],
  )

  return element('w:r', undefined, element('w:drawing', undefined, inline))
}

// ─── Document ──────────────────────────────────────────────────────────────

const NAMESPACES = {
  'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'xmlns:r':
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'xmlns:wp':
    'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
} as const

const sectionProperties = (): string =>
  element('w:sectPr', undefined, [
    element('w:pgSz', { 'w:w': PAGE.width, 'w:h': PAGE.height }),
    element('w:pgMar', {
      'w:top': PAGE.margin,
      'w:right': PAGE.margin,
      'w:bottom': PAGE.margin,
      'w:left': PAGE.margin,
      'w:header': 720,
      'w:footer': 720,
      'w:gutter': 0,
    }),
  ])

/**
 * Threads whose anchor the user deleted have nothing to attach to, so they are
 * gathered under a heading at the end — the same fallback the annotated HTML
 * export uses when a thread has no place in document order.
 */
function unanchoredSection(context: RenderContext): string {
  if (!context.comments) return ''
  const orphans = context.comments.claimUnanchored()
  if (!orphans.length) return ''

  const heading = paragraphElement(
    { style: STYLE_IDS.heading(2) },
    element(
      'w:r',
      undefined,
      textElement('w:t', undefined, 'Comments without anchors'),
    ),
  )

  const items = orphans.map(entry =>
    paragraphElement(
      {},
      commentRangeStart(entry.id) +
        element(
          'w:r',
          undefined,
          textElement(
            'w:t',
            { 'xml:space': 'preserve' },
            entry.thread.selector.exact || 'Deleted text',
          ),
        ) +
        commentRangeEnd(entry.id),
    ),
  )

  return heading + items.join('')
}

export function buildDocument(
  doc: JSONContent,
  context: RenderContext,
): string {
  const body = renderBlocks(doc.content ?? [], context)
  const orphans = unanchoredSection(context)

  return xmlPart(
    element(
      'w:document',
      NAMESPACES,
      element('w:body', undefined, body + orphans + sectionProperties()),
    ),
  )
}
