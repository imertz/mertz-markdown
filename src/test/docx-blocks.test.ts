import { describe, expect, it } from 'vitest'
import { createTestEditor, createTestEditorFromJSON } from './editorHarness'
import { documentText, elements, exportDocx } from './docxHarness'

/** The `w:numId` values used by the body, in order of first appearance. */
const numIds = (body: string): number[] => {
  const seen: number[] = []
  for (const match of body.matchAll(/<w:numId w:val="(\d+)"\/>/g)) {
    const id = Number(match[1])
    if (!seen.includes(id)) seen.push(id)
  }
  return seen
}

describe('docx block mapping', () => {
  it('maps heading levels onto Word heading styles', async () => {
    const editor = createTestEditor('# One\n\n## Two\n\n###### Six\n')
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(body).toContain('<w:pStyle w:val="Heading1"/>')
    expect(body).toContain('<w:pStyle w:val="Heading2"/>')
    expect(body).toContain('<w:pStyle w:val="Heading6"/>')
    expect(documentText(body)).toBe('OneTwoSix')
  })

  it('gives headings an outline level so they reach the navigation pane', async () => {
    const editor = createTestEditor('## Two\n')
    const styles = (await exportDocx(editor)).text('word/styles.xml')

    // 0-based, unlike the style id — the classic off-by-one in this part.
    expect(styles).toContain('<w:name w:val="heading 2"/>')
    expect(styles).toMatch(/Heading2[\s\S]*?<w:outlineLvl w:val="1"\/>/)
  })

  it('carries every visible mark', async () => {
    const editor = createTestEditor(
      '**bold** *italic* ~~struck~~ `code`\n',
    )
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(body).toContain('<w:b/>')
    expect(body).toContain('<w:i/>')
    expect(body).toContain('<w:strike/>')
    expect(body).toContain('<w:rStyle w:val="CodeChar"/>')
  })

  it('wraps a link in a hyperlink carrying the Hyperlink style', async () => {
    const editor = createTestEditor('See [the docs](https://example.com).\n')
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(body).toMatch(
      /<w:hyperlink r:id="rId\d+"><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/>/,
    )
  })

  it('preserves significant whitespace in a run', async () => {
    const editor = createTestEditor('a **b** c\n')
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(body).toContain('xml:space="preserve"')
    expect(documentText(body)).toBe('a b c')
  })

  it('numbers a bulleted list and steps the level when it nests', async () => {
    const editor = createTestEditor('- one\n  - nested\n- two\n')
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(body).toContain('<w:ilvl w:val="0"/>')
    expect(body).toContain('<w:ilvl w:val="1"/>')
  })

  it('gives a bulleted list nested in an ordered one its own definition', async () => {
    // Sharing the parent's instance draws the inner list with the OUTER
    // definition's level-1 format, so bullets silently come out as "a. b.".
    const editor = createTestEditor('1. one\n   - nested\n   - also\n2. two\n')
    const exported = await exportDocx(editor)
    const body = exported.text('word/document.xml')
    const numbering = exported.text('word/numbering.xml')

    const kindOf = new Map(
      [...numbering.matchAll(
        /<w:num w:numId="(\d+)"><w:abstractNumId w:val="(\d+)"\/>/g,
      )].map(match => [match[1]!, match[2]!]),
    )

    // Every numPr in the body, paired as [ilvl, numId].
    const used = [
      ...body.matchAll(/<w:ilvl w:val="(\d+)"\/><w:numId w:val="(\d+)"\/>/g),
    ].map(match => ({ level: match[1]!, abstract: kindOf.get(match[2]!) }))

    // abstractNum 0 is the bulleted definition, 1 the ordered one.
    expect(used.filter(entry => entry.level === '0')).toEqual([
      { level: '0', abstract: '1' },
      { level: '0', abstract: '1' },
    ])
    expect(used.filter(entry => entry.level === '1')).toEqual([
      { level: '1', abstract: '0' },
      { level: '1', abstract: '0' },
    ])
  })

  it('restarts a second ordered list instead of continuing the first', async () => {
    // The failure this guards is invisible in the XML and obvious in Word:
    // a shared numId makes the second list carry on at 4.
    const editor = createTestEditor('1. a\n2. b\n\nBreak.\n\n1. c\n2. d\n')
    const exported = await exportDocx(editor)
    const body = exported.text('word/document.xml')

    const used = numIds(body)
    expect(used).toHaveLength(2)
    expect(used[0]).not.toBe(used[1])

    const numbering = exported.text('word/numbering.xml')
    expect(elements(numbering, 'w:num')).toHaveLength(2)
  })

  it('honours an ordered list that does not start at one', async () => {
    const editor = createTestEditor('5. five\n6. six\n')
    const numbering = (await exportDocx(editor)).text('word/numbering.xml')

    expect(numbering).toContain('<w:startOverride w:val="5"/>')
  })

  it('marks task items with a box glyph rather than a bullet', async () => {
    const editor = createTestEditor('- [ ] open\n- [x] done\n')
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(documentText(body)).toBe('☐ open☒ done')
    // A task list is not a numbered list; it must not claim an instance.
    expect(numIds(body)).toHaveLength(0)
  })

  it('keeps a code block in one shaded paragraph with breaks between lines', async () => {
    const editor = createTestEditor('```js\nconst a = 1\nconst b = 2\n```\n')
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(elements(body, 'w:p')).toHaveLength(1)
    expect(body).toContain('<w:pStyle w:val="SourceCode"/>')
    expect(body.match(/<w:br\/>/g)).toHaveLength(1)
    expect(documentText(body)).toBe('const a = 1const b = 2')
  })

  it('styles a blockquote and indents a nested one further', async () => {
    const editor = createTestEditor('> outer\n>\n> > inner\n')
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(body).toContain('<w:pStyle w:val="Quote"/>')
    const indents = [...body.matchAll(/<w:ind w:left="(\d+)"\/>/g)].map(match =>
      Number(match[1]),
    )
    expect(indents).toHaveLength(2)
    expect(indents[1]).toBeGreaterThan(indents[0]!)
  })

  it('draws a horizontal rule as a bordered empty paragraph', async () => {
    const editor = createTestEditor('above\n\n---\n\nbelow\n')
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(body).toContain('<w:pBdr><w:bottom')
    expect(documentText(body)).toBe('abovebelow')
  })

  it('turns a hard break into a run break, not a paragraph', async () => {
    const editor = createTestEditor('one  \ntwo\n')
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(elements(body, 'w:p')).toHaveLength(1)
    expect(body).toContain('<w:br/>')
  })

  it('justifies only the paragraphs the document says to justify', async () => {
    const editor = createTestEditorFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'justify' },
          content: [{ type: 'text', text: 'justified' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'plain' }] },
      ],
    })
    const body = (await exportDocx(editor)).text('word/document.xml')

    // `both` is Word's name for justified; `justify` would be silently ignored.
    expect(body.match(/<w:jc w:val="both"\/>/g)).toHaveLength(1)
  })

  it('ends the body with A4 page settings', async () => {
    const editor = createTestEditor('Prose.\n')
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(body).toContain('<w:pgSz w:w="11906" w:h="16838"/>')
    expect(body).toMatch(/<w:sectPr>[\s\S]*<\/w:sectPr><\/w:body>/)
  })
})

describe('docx tables', () => {
  const TABLE = [
    '| Left | Middle | Right |',
    '| :--- | :----: | ----: |',
    '| a    | b      | c     |',
    '',
  ].join('\n')

  it('emits a grid, a repeating header row and per-column alignment', async () => {
    const editor = createTestEditor(TABLE)
    const body = (await exportDocx(editor)).text('word/document.xml')

    expect(elements(body, 'w:gridCol')).toHaveLength(3)
    expect(body).toContain('<w:tblHeader/>')
    expect(body).toContain('<w:jc w:val="center"/>')
    expect(body).toContain('<w:jc w:val="right"/>')
    expect(documentText(body)).toBe('LeftMiddleRightabc')
  })

  it('bolds the header row through a paragraph style', async () => {
    const editor = createTestEditor(TABLE)
    const exported = await exportDocx(editor)

    expect(exported.text('word/document.xml')).toContain(
      '<w:pStyle w:val="TableHeaderText"/>',
    )
    expect(exported.text('word/styles.xml')).toMatch(
      /TableHeaderText[\s\S]*?<w:rPr><w:b\/><\/w:rPr>/,
    )
  })

  it('never leaves a cell without a paragraph', async () => {
    const editor = createTestEditor(
      ['| A | B |', '| - | - |', '|   | b |', ''].join('\n'),
    )
    const body = (await exportDocx(editor)).text('word/document.xml')

    for (const cell of elements(body, 'w:tc')) {
      expect(cell, cell).toContain('<w:p')
    }
  })
})
