import { describe, expect, it } from 'vitest'
import { createTestEditor } from './editorHarness'
import { exportDocx } from './docxHarness'

const REQUIRED_PARTS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'docProps/core.xml',
  'word/document.xml',
  'word/_rels/document.xml.rels',
  'word/styles.xml',
  'word/numbering.xml',
]

/** Every `Id="rIdN"` a `.rels` part declares. */
const declaredIds = (rels: string): Set<string> =>
  new Set((rels.match(/Id="(rId\d+)"/g) ?? []).map(match => match.slice(4, -1)))

/** Every `r:id` / `r:embed` the body references. */
const referencedIds = (document_: string): Set<string> =>
  new Set(
    (document_.match(/r:(?:id|embed)="(rId\d+)"/g) ?? []).map(match =>
      match.replace(/^.*"(rId\d+)"$/, '$1'),
    ),
  )

describe('docx package', () => {
  it('writes every part Word requires', async () => {
    const editor = createTestEditor('# Title\n\nSome prose.\n')
    const exported = await exportDocx(editor)

    for (const part of REQUIRED_PARTS) {
      expect(Object.keys(exported.parts)).toContain(part)
    }
  })

  it('omits the comments part from the clean export', async () => {
    const editor = createTestEditor('Plain.\n')
    const exported = await exportDocx(editor)

    expect(Object.keys(exported.parts)).not.toContain('word/comments.xml')
    expect(exported.text('[Content_Types].xml')).not.toContain('comments+xml')
  })

  it('starts every XML part with a declaration', async () => {
    const editor = createTestEditor('Prose.\n')
    const exported = await exportDocx(editor)

    for (const [path, bytes] of Object.entries(exported.parts)) {
      if (!path.endsWith('.xml') && !path.endsWith('.rels')) continue
      expect(new TextDecoder().decode(bytes.slice(0, 5)), path).toBe('<?xml')
    }
  })

  it('resolves every relationship the body references', async () => {
    // The single most common way to make Word declare a file corrupt.
    const editor = createTestEditor(
      'A [link](https://example.com) and [another](https://example.org/a).\n',
    )
    const exported = await exportDocx(editor)

    const declared = declaredIds(exported.text('word/_rels/document.xml.rels'))
    const referenced = referencedIds(exported.text('word/document.xml'))

    expect(referenced.size).toBeGreaterThan(0)
    for (const id of referenced) {
      expect(declared, `${id} is referenced but not declared`).toContain(id)
    }
  })

  it('mints one relationship per distinct hyperlink target', async () => {
    const editor = createTestEditor(
      '[one](https://example.com) [two](https://example.com) [three](https://other.example)\n',
    )
    const exported = await exportDocx(editor)
    const rels = exported.text('word/_rels/document.xml.rels')

    expect(rels.match(/TargetMode="External"/g)).toHaveLength(2)
    expect(rels).toContain('Target="https://example.com"')
    expect(rels).toContain('Target="https://other.example"')
  })

  it('names every content-type override after a part that exists', async () => {
    const editor = createTestEditor('Prose.\n')
    const exported = await exportDocx(editor)

    const overrides = (
      exported.text('[Content_Types].xml').match(/PartName="([^"]+)"/g) ?? []
    ).map(match => match.slice(10, -1).replace(/^\//, ''))

    expect(overrides.length).toBeGreaterThan(0)
    for (const part of overrides) {
      expect(Object.keys(exported.parts), part).toContain(part)
    }
  })

  it('carries the document title and no application stamp', async () => {
    const editor = createTestEditor('Prose.\n')
    const exported = await exportDocx(editor, { title: 'Release plan' })

    expect(exported.text('docProps/core.xml')).toContain(
      '<dc:title>Release plan</dc:title>',
    )
    // Nothing in the package should name the tool that made it.
    for (const [path, bytes] of Object.entries(exported.parts)) {
      expect(new TextDecoder().decode(bytes), path).not.toMatch(/mertz/i)
    }
  })

  it('sanitises the filename and appends the extension', async () => {
    const editor = createTestEditor('Prose.\n')
    const exported = await exportDocx(editor, { title: 'Q3/Q4: plan' })

    expect(exported.filename).toBe('Q3-Q4- plan.docx')
  })

  it('escapes text that would otherwise close an element', async () => {
    const editor = createTestEditor('5 < 6 & "quoted" > 4\n')
    const exported = await exportDocx(editor)
    const body = exported.text('word/document.xml')

    expect(body).toContain('5 &lt; 6 &amp; "quoted" &gt; 4')
  })
})
