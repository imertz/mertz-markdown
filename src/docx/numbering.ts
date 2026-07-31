import { element, xmlPart } from './xml'
import { twipsFromInches } from './units'

/**
 * `word/numbering.xml`.
 *
 * Two abstract definitions — one bulleted, one ordered — and one concrete
 * `w:num` per list *occurrence* in the document.
 *
 * The per-occurrence part is the whole reason this file has a registry rather
 * than two constants. A `w:num` is a running counter, so two ordered lists
 * sharing a numId produce "1. 2. 3." followed by "4. 5. 6." — the second list
 * silently continues the first. Handing every list its own instance is what
 * makes each one start over, which is what the ProseMirror document means.
 */

const BULLET_ABSTRACT = 0
const ORDERED_ABSTRACT = 1

/** numId 0 is reserved by the spec for "numbering removed". */
const FIRST_NUM_ID = 1

const LEVELS = 9

export type ListKind = 'bullet' | 'ordered'

export interface NumberingInstance {
  numId: number
  kind: ListKind
  /** Where the counter begins; only an `orderedList` can move it. */
  start: number
}

/**
 * Hands out numbering instances as the document walk meets lists, and holds
 * them until `buildNumbering` turns the collected set into the part.
 */
export class NumberingRegistry {
  private readonly allocated: NumberingInstance[] = []

  allocate(kind: ListKind, start = 1): number {
    const numId = FIRST_NUM_ID + this.allocated.length
    this.allocated.push({ numId, kind, start })
    return numId
  }

  get instances(): readonly NumberingInstance[] {
    return this.allocated
  }
}

const indentFor = (level: number): string =>
  element('w:pPr', undefined, [
    element('w:ind', {
      'w:left': twipsFromInches(0.5 * (level + 1)),
      'w:hanging': twipsFromInches(0.25),
    }),
  ])

/** Word's conventional bullet glyphs: Symbol •, Courier o, Wingdings ▪. */
const BULLET_GLYPHS = [
  { text: '', font: 'Symbol' },
  { text: 'o', font: 'Courier New' },
  { text: '', font: 'Wingdings' },
] as const

const ORDERED_FORMATS = ['decimal', 'lowerLetter', 'lowerRoman'] as const

function bulletLevel(level: number): string {
  const glyph = BULLET_GLYPHS[level % BULLET_GLYPHS.length] ?? BULLET_GLYPHS[0]
  return element('w:lvl', { 'w:ilvl': level }, [
    element('w:start', { 'w:val': 1 }),
    element('w:numFmt', { 'w:val': 'bullet' }),
    element('w:lvlText', { 'w:val': glyph.text }),
    element('w:lvlJc', { 'w:val': 'left' }),
    indentFor(level),
    element(
      'w:rPr',
      undefined,
      element('w:rFonts', {
        'w:ascii': glyph.font,
        'w:hAnsi': glyph.font,
        'w:hint': 'default',
      }),
    ),
  ])
}

function orderedLevel(level: number): string {
  const format = ORDERED_FORMATS[level % ORDERED_FORMATS.length] ?? 'decimal'
  return element('w:lvl', { 'w:ilvl': level }, [
    element('w:start', { 'w:val': 1 }),
    element('w:numFmt', { 'w:val': format }),
    // `%1` is level 1, so the placeholder is one-based while `w:ilvl` is not.
    element('w:lvlText', { 'w:val': `%${level + 1}.` }),
    element('w:lvlJc', { 'w:val': 'left' }),
    indentFor(level),
  ])
}

function abstractNum(id: number, build: (level: number) => string): string {
  return element('w:abstractNum', { 'w:abstractNumId': id }, [
    element('w:multiLevelType', { 'w:val': 'hybridMultilevel' }),
    ...Array.from({ length: LEVELS }, (_, level) => build(level)),
  ])
}

function num(instance: NumberingInstance): string {
  const abstract =
    instance.kind === 'bullet' ? BULLET_ABSTRACT : ORDERED_ABSTRACT

  // A distinct numId is already enough to restart the counter in Word, but
  // LibreOffice has historically carried it over. Stating the start explicitly
  // costs one element and removes the question.
  const override =
    instance.kind === 'ordered'
      ? element(
          'w:lvlOverride',
          { 'w:ilvl': 0 },
          element('w:startOverride', { 'w:val': instance.start }),
        )
      : ''

  return element('w:num', { 'w:numId': instance.numId }, [
    element('w:abstractNumId', { 'w:val': abstract }),
    override,
  ])
}

export function buildNumbering(
  instances: readonly NumberingInstance[],
): string {
  return xmlPart(
    element(
      'w:numbering',
      {
        'xmlns:w':
          'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      },
      [
        // Abstract definitions must precede every w:num that references them.
        abstractNum(BULLET_ABSTRACT, bulletLevel),
        abstractNum(ORDERED_ABSTRACT, orderedLevel),
        ...instances.map(num),
      ],
    ),
  )
}
