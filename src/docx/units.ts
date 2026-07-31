/**
 * OOXML measures the same page in four different units depending on where you
 * are standing. Every conversion in the exporter goes through this file so the
 * factors are stated once.
 */

/** English Metric Units per CSS pixel, at the 96 DPI the browser reports in. */
const EMU_PER_PIXEL = 9525

/** Twentieths of a point. Indents, borders and table widths are in these. */
const TWIPS_PER_POINT = 20
const TWIPS_PER_INCH = 1440

/** A4 in twips, and the one-inch margins `w:sectPr` sets around it. */
export const PAGE = {
  width: 11906,
  height: 16838,
  margin: TWIPS_PER_INCH,
} as const

/** The text column every width in the document is measured against. */
export const CONTENT_WIDTH_TWIPS = PAGE.width - 2 * PAGE.margin
export const CONTENT_WIDTH_EMU = emuFromPixels(
  (CONTENT_WIDTH_TWIPS / TWIPS_PER_INCH) * 96,
)

/** ProseMirror's table `colwidth` is in CSS pixels; column widths are not. */
export function twipsFromPixels(pixels: number): number {
  return Math.round((pixels / 96) * TWIPS_PER_INCH)
}

export function emuFromPixels(pixels: number): number {
  return Math.round(pixels * EMU_PER_PIXEL)
}

export function twipsFromPoints(points: number): number {
  return Math.round(points * TWIPS_PER_POINT)
}

export function twipsFromInches(inches: number): number {
  return Math.round(inches * TWIPS_PER_INCH)
}

/** `w:sz` is in half-points, so a 12pt font is `24`. */
export function halfPoints(points: number): number {
  return Math.round(points * 2)
}

export interface Size {
  width: number
  height: number
}

/**
 * Shrink to fit the text column, preserving the aspect ratio.
 *
 * Word does not clamp for you: an image wider than the column is cropped at the
 * page edge rather than scaled, and the missing part is simply not printed.
 */
export function fitWithin(size: Size, maxWidth: number): Size {
  if (size.width <= maxWidth || size.width <= 0) return size
  const scale = maxWidth / size.width
  return {
    width: maxWidth,
    // At least 1 EMU: a rounded-to-zero extent makes Word report the file as
    // corrupt rather than drawing nothing.
    height: Math.max(1, Math.round(size.height * scale)),
  }
}
