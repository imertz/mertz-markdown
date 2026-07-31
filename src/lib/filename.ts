/** Characters no mainstream filesystem accepts in a name. */
const ILLEGAL = /[/\\?%*:|"<>]/g

/**
 * A document title reduced to a safe download filename stem.
 *
 * Shared by every export path so a title behaves identically whether it leaves
 * as `.md`, `.zip`, `.html` or `.docx` — three copies of this regex had already
 * drifted apart on the length cap.
 */
export function safeStem(value: string): string {
  return value.replace(ILLEGAL, '-').slice(0, 100) || 'document'
}

/** `safeStem`, with `extension` appended unless it is already there. */
export function withExtension(value: string, extension: string): string {
  const stem = safeStem(value)
  return stem.toLowerCase().endsWith(`.${extension}`) ? stem : `${stem}.${extension}`
}
