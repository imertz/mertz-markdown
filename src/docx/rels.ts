import { element, xmlPart } from './xml'

/**
 * A `.rels` part.
 *
 * Every reference out of `document.xml` — a hyperlink target, an image part,
 * the styles part — is indirect: the body carries an `r:id`, and the mapping
 * from that id to a target lives here. An `r:id` with no matching relationship
 * is the single most common way to make Word declare a file corrupt, so ids are
 * only ever minted by `add` and never written by hand.
 */

const RELATIONSHIP_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'

const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export const RELATIONSHIP_TYPES = {
  officeDocument: `${OFFICE}/officeDocument`,
  coreProperties:
    'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  styles: `${OFFICE}/styles`,
  numbering: `${OFFICE}/numbering`,
  comments: `${OFFICE}/comments`,
  hyperlink: `${OFFICE}/hyperlink`,
  image: `${OFFICE}/image`,
} as const

interface Relationship {
  id: string
  type: string
  target: string
  external: boolean
}

export class Relationships {
  private readonly entries: Relationship[] = []

  /** `target` is relative to the part that owns this `.rels`, unless external. */
  add(type: string, target: string, external = false): string {
    const id = `rId${this.entries.length + 1}`
    this.entries.push({ id, type, target, external })
    return id
  }

  /** Every id minted so far, for the integrity check in the tests. */
  get ids(): readonly string[] {
    return this.entries.map(entry => entry.id)
  }

  toXml(): string {
    return xmlPart(
      element(
        'Relationships',
        { xmlns: RELATIONSHIP_NAMESPACE },
        this.entries.map(entry =>
          element('Relationship', {
            Id: entry.id,
            Type: entry.type,
            Target: entry.target,
            TargetMode: entry.external ? 'External' : undefined,
          }),
        ),
      ),
    )
  }
}
