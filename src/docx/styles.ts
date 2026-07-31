import { element, xmlPart } from './xml'
import { halfPoints, twipsFromInches, twipsFromPoints } from './units'

/**
 * `word/styles.xml`.
 *
 * Deliberately fixed rather than derived from the app's theme or its reading
 * font. `useDocumentFont` documents itself as "a global reading preference" —
 * a setting about this user's eyes, not about the document — so baking it into
 * a file handed to someone else would export the wrong thing. Calibri and
 * Consolas are what Word ships with, which is what makes the result look like a
 * Word document rather than a web page that got lost.
 */

const BODY_FONT = 'Calibri'
const MONO_FONT = 'Consolas'

/** Warm neutrals matching the app's own palette, for the few tinted styles. */
const RULE_COLOUR = 'D9D4CA'
const CODE_FILL = 'F2EFE9'
const MUTED_TEXT = '6D675F'
const LINK_COLOUR = '0563C1'

const font = (name: string): string =>
  element('w:rFonts', { 'w:ascii': name, 'w:hAnsi': name, 'w:cs': name })

const size = (points: number): string =>
  element('w:sz', { 'w:val': halfPoints(points) }) +
  element('w:szCs', { 'w:val': halfPoints(points) })

const shading = (fill: string): string =>
  element('w:shd', { 'w:val': 'clear', 'w:color': 'auto', 'w:fill': fill })

const border = (
  edge: 'top' | 'bottom' | 'left' | 'right',
  options: { size: number; colour: string; space?: number },
): string =>
  element(`w:${edge}`, {
    'w:val': 'single',
    'w:sz': options.size,
    'w:space': options.space ?? 0,
    'w:color': options.colour,
  })

interface StyleOptions {
  id: string
  /**
   * The BUILT-IN name where one exists ("heading 1", not "Heading 1"). Word
   * matches its own styles by this string, not by the id — get it wrong and a
   * heading stops appearing in the navigation pane and in a generated table of
   * contents, while still looking correct on the page.
   */
  name: string
  type?: 'paragraph' | 'character'
  basedOn?: string
  next?: string
  quickFormat?: boolean
  paragraph?: string
  run?: string
}

function style(options: StyleOptions): string {
  const {
    id,
    name,
    type = 'paragraph',
    basedOn,
    next,
    quickFormat,
    paragraph,
    run,
  } = options

  return element('w:style', { 'w:type': type, 'w:styleId': id }, [
    element('w:name', { 'w:val': name }),
    basedOn ? element('w:basedOn', { 'w:val': basedOn }) : '',
    next ? element('w:next', { 'w:val': next }) : '',
    quickFormat ? element('w:qFormat') : '',
    paragraph ? element('w:pPr', undefined, paragraph) : '',
    run ? element('w:rPr', undefined, run) : '',
  ])
}

/** Point size per heading level, indexed from 1. */
const HEADING_POINTS = [0, 24, 19, 15, 13, 12, 11]

function headingStyle(level: number): string {
  return style({
    id: `Heading${level}`,
    name: `heading ${level}`,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    paragraph: [
      // A heading orphaned at the foot of a page reads as a mistake.
      element('w:keepNext'),
      element('w:keepLines'),
      element('w:spacing', {
        'w:before': twipsFromPoints(level <= 2 ? 18 : 12),
        'w:after': twipsFromPoints(6),
      }),
      // 0-based, unlike the style id. This is what feeds the navigation pane.
      element('w:outlineLvl', { 'w:val': level - 1 }),
    ].join(''),
    run: [
      element('w:b'),
      size(HEADING_POINTS[level] ?? 11),
      level >= 5 ? element('w:i') : '',
    ].join(''),
  })
}

export const STYLE_IDS = {
  heading: (level: number) => `Heading${level}`,
  quote: 'Quote',
  codeBlock: 'SourceCode',
  codeSpan: 'CodeChar',
  hyperlink: 'Hyperlink',
  listParagraph: 'ListParagraph',
  tableHeader: 'TableHeaderText',
  caption: 'Caption',
  commentReference: 'CommentReference',
  commentText: 'CommentText',
} as const

export function buildStyles(): string {
  const defaults = element('w:docDefaults', undefined, [
    element(
      'w:rPrDefault',
      undefined,
      element('w:rPr', undefined, font(BODY_FONT) + size(11)),
    ),
    element(
      'w:pPrDefault',
      undefined,
      element(
        'w:pPr',
        undefined,
        element('w:spacing', {
          'w:after': twipsFromPoints(8),
          'w:line': 259,
          'w:lineRule': 'auto',
        }),
      ),
    ),
  ])

  const styles = [
    element(
      'w:style',
      { 'w:type': 'paragraph', 'w:default': '1', 'w:styleId': 'Normal' },
      element('w:name', { 'w:val': 'Normal' }) + element('w:qFormat'),
    ),

    ...[1, 2, 3, 4, 5, 6].map(headingStyle),

    style({
      id: STYLE_IDS.quote,
      name: 'Quote',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      paragraph:
        element(
          'w:pBdr',
          undefined,
          border('left', { size: 18, colour: RULE_COLOUR, space: 8 }),
        ) + element('w:ind', { 'w:left': twipsFromInches(0.25) }),
      run: element('w:i') + element('w:color', { 'w:val': MUTED_TEXT }),
    }),

    style({
      id: STYLE_IDS.codeBlock,
      name: 'Source Code',
      basedOn: 'Normal',
      next: 'Normal',
      paragraph: [
        shading(CODE_FILL),
        element(
          'w:pBdr',
          undefined,
          (['top', 'left', 'bottom', 'right'] as const)
            .map(edge => border(edge, { size: 4, colour: RULE_COLOUR, space: 4 }))
            .join(''),
        ),
        element('w:spacing', {
          'w:before': twipsFromPoints(6),
          'w:after': twipsFromPoints(6),
          'w:line': 240,
          'w:lineRule': 'auto',
        }),
        element('w:ind', {
          'w:left': twipsFromInches(0.1),
          'w:right': twipsFromInches(0.1),
        }),
      ].join(''),
      run: font(MONO_FONT) + size(10),
    }),

    style({
      id: STYLE_IDS.codeSpan,
      name: 'Code Char',
      type: 'character',
      run: font(MONO_FONT) + size(10) + shading(CODE_FILL),
    }),

    style({
      id: STYLE_IDS.hyperlink,
      name: 'Hyperlink',
      type: 'character',
      run:
        element('w:color', { 'w:val': LINK_COLOUR }) +
        element('w:u', { 'w:val': 'single' }),
    }),

    // Word's own name for "a paragraph that is part of a list". Using it is
    // what makes contextualSpacing collapse the gap between list items.
    style({
      id: STYLE_IDS.listParagraph,
      name: 'List Paragraph',
      basedOn: 'Normal',
      quickFormat: true,
      paragraph: element('w:contextualSpacing'),
    }),

    // A paragraph style rather than a run one: its `w:rPr` reaches every run in
    // the paragraph, so a header cell is bold without the walker having to mark
    // each text node it contains.
    style({
      id: STYLE_IDS.tableHeader,
      name: 'Table Header Text',
      basedOn: 'Normal',
      next: 'Normal',
      paragraph: element('w:spacing', { 'w:after': 0 }),
      run: element('w:b'),
    }),

    style({
      id: STYLE_IDS.caption,
      name: 'caption',
      basedOn: 'Normal',
      next: 'Normal',
      paragraph: element('w:spacing', { 'w:after': twipsFromPoints(10) }),
      run: size(9) + element('w:color', { 'w:val': MUTED_TEXT }),
    }),

    style({
      id: STYLE_IDS.commentReference,
      name: 'annotation reference',
      type: 'character',
      run: size(8),
    }),

    style({
      id: STYLE_IDS.commentText,
      name: 'annotation text',
      basedOn: 'Normal',
      paragraph: element('w:spacing', {
        'w:after': 0,
        'w:line': 240,
        'w:lineRule': 'auto',
      }),
      run: size(10),
    }),
  ]

  return xmlPart(
    element(
      'w:styles',
      {
        'xmlns:w':
          'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      },
      [defaults, ...styles],
    ),
  )
}
