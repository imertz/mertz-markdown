/**
 * The smallest XML writer that can produce OOXML, and nothing more.
 *
 * A `.docx` is a ZIP of XML parts, so a serializer is unavoidable — but the
 * parts this app emits are built from a fixed vocabulary, never parsed back,
 * and never round-tripped. That rules out a DOM and rules out a dependency:
 * string concatenation with disciplined escaping is the whole requirement.
 */

export type XmlAttributes = Record<string, string | number | undefined>

/**
 * Characters XML 1.0 §2.2 forbids outright, stripped rather than escaped.
 *
 * There is no legal encoding for them — `&#x0;` is as invalid as a raw NUL —
 * so a document that somehow acquired one (a bad paste, a corrupt import)
 * would produce a file Word refuses to open with no indication why. Dropping
 * them costs a character nobody can see.
 */
// oxlint-disable-next-line no-control-regex -- matching them is the whole point
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

const TEXT_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}

const ATTRIBUTE_ESCAPES: Record<string, string> = {
  ...TEXT_ESCAPES,
  '"': '&quot;',
  "'": '&apos;',
  // A literal tab or newline inside an attribute is normalized away by any
  // conforming parser, so it has to survive as a reference or be lost.
  '\t': '&#9;',
  '\n': '&#10;',
  '\r': '&#13;',
}

export function escapeText(value: string): string {
  return value
    .replace(FORBIDDEN, '')
    .replace(/[&<>]/g, character => TEXT_ESCAPES[character] ?? character)
}

export function escapeAttribute(value: string): string {
  return value
    .replace(FORBIDDEN, '')
    .replace(/[&<>"'\t\n\r]/g, character => ATTRIBUTE_ESCAPES[character] ?? character)
}

function serializeAttributes(attributes: XmlAttributes | undefined): string {
  if (!attributes) return ''
  let out = ''
  for (const [name, value] of Object.entries(attributes)) {
    // `undefined` means "attribute not applicable here", which is what lets a
    // caller build an attribute set with inline conditionals. An empty string
    // is a legitimate value and is kept.
    if (value === undefined) continue
    out += ` ${name}="${escapeAttribute(String(value))}"`
  }
  return out
}

/**
 * One element. `children` already being XML is the point — every caller below
 * composes elements, and text reaches this file only through `escapeText`.
 */
export function element(
  name: string,
  attributes?: XmlAttributes,
  children?: string | readonly string[],
): string {
  const body = Array.isArray(children) ? children.join('') : (children ?? '')
  const head = `${name}${serializeAttributes(attributes)}`
  return body === '' ? `<${head}/>` : `<${head}>${body}</${name}>`
}

/** An element whose only content is escaped text. */
export function textElement(
  name: string,
  attributes: XmlAttributes | undefined,
  text: string,
): string {
  return `<${name}${serializeAttributes(attributes)}>${escapeText(text)}</${name}>`
}

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** A complete part: declaration plus root. Word rejects a part without one. */
export function xmlPart(root: string): string {
  return `${DECLARATION}\r\n${root}`
}
