import type { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { resolveSelector } from '../markdown/anchors'
import { collectPassages } from '../search/passages'
import { createTestEditor } from './editorHarness'
import { makeDocument } from './dbHarness'

/**
 * The test the whole jump mechanism rests on.
 *
 * A search hit becomes a caret position by handing its anchor to
 * `resolveSelector` — the same resolver comment re-anchoring uses. If the
 * anchors built from JSON disagree with the flattening that resolver performs
 * over ProseMirror positions, nothing throws: the hit just opens the document
 * and leaves the caret where it was. So assert the contract directly, over real
 * editors, rather than testing the flattener's internals.
 */

const passagesFor = (markdown: string) => {
  const editor = createTestEditor(markdown)
  const record = makeDocument({ doc: editor.getJSON(), title: 'Fixture' })
  return { editor, passages: collectPassages(record) }
}

/** Every passage that quotes something — the title record deliberately does not. */
const anchored = (markdown: string) => {
  const { editor, passages } = passagesFor(markdown)
  return { editor, passages: passages.filter(p => p.anchor.exact !== '') }
}

const textAt = (editor: Editor, range: { from: number; to: number }) =>
  editor.state.doc.textBetween(range.from, range.to, '\n', '\n')

const FIXTURES: Record<string, string> = {
  'headings and prose': [
    '# Title',
    '',
    'An opening paragraph about tables.',
    '',
    '## Known limitations',
    '',
    'A literal pipe breaks the file.',
  ].join('\n'),

  'bullet and ordered lists': [
    '- First item',
    '- Second item with more words',
    '',
    '1. Step one',
    '2. Step two',
  ].join('\n'),

  'task list': ['- [ ] Unchecked thing', '- [x] Checked thing'].join('\n'),

  'code block': ['```ts', 'const answer = 42', '```', '', 'After the code.'].join('\n'),

  'table': [
    '| Name | Role |',
    '| --- | --- |',
    '| Ada | Engineer |',
    '| Grace | Admiral |',
  ].join('\n'),

  'blockquote': ['> Quoted wisdom here.', '', 'Ordinary text after.'].join('\n'),

  'inline image between text': 'hello ![](img.png) world',

  'image opening a paragraph': '![](img.png) trailing words here',

  'greek and english mixed': [
    '# Γραμματοσειρές',
    '',
    'Η πλατεία ήταν γεμάτη κόσμο.',
    '',
    'The square was full of people.',
  ].join('\n'),

  'repeated identical blocks': ['Done', '', 'Something else', '', 'Done'].join('\n\n'),
}

describe('search anchors resolve back to editor positions', () => {
  for (const [name, markdown] of Object.entries(FIXTURES)) {
    it(`resolves every anchor: ${name}`, () => {
      const { editor, passages } = anchored(markdown)
      expect(passages.length).toBeGreaterThan(0)

      for (const passage of passages) {
        const range = resolveSelector(editor.state.doc, passage.anchor)
        expect(range, `unresolved anchor: ${JSON.stringify(passage.anchor)}`).not.toBeNull()
        // Not just "found something" — found the text it quoted.
        expect(textAt(editor, range!)).toBe(passage.anchor.exact)
      }
    })
  }

  it('quotes text either side of an inline image, never across it', () => {
    // The separator rule: `hello ![](img) world` flattens with a newline where
    // the image sits, so an anchor that concatenated the runs would never
    // resolve. The anchor must stop at the image.
    const { passages } = anchored('hello ![](img.png) world')
    expect(passages[0].anchor.exact).toBe('hello ')
  })

  it('skips a leading whitespace run to quote real content', () => {
    // A paragraph opening with an image yields an empty first run; anchoring on
    // it would match the first stray gap anywhere in the document.
    const { editor, passages } = anchored('![](img.png) trailing words here')
    expect(passages[0].anchor.exact.trim()).not.toBe('')
    expect(textAt(editor, resolveSelector(editor.state.doc, passages[0].anchor)!)).toBe(
      passages[0].anchor.exact,
    )
  })

  it('distinguishes repeated blocks by their surrounding context', () => {
    const { editor, passages } = anchored(['Done', '', 'Middle', '', 'Done'].join('\n'))
    const dones = passages.filter(p => p.anchor.exact === 'Done')
    expect(dones).toHaveLength(2)

    const first = resolveSelector(editor.state.doc, dones[0].anchor)
    const second = resolveSelector(editor.state.doc, dones[1].anchor)
    // Identical quotes, different positions — that is what prefix/suffix buy.
    expect(first!.from).not.toBe(second!.from)
  })

  it('gives the title record no anchor, so a title hit just opens the document', () => {
    const { passages } = passagesFor('# Something\n\nBody text.')
    const title = passages.find(p => p.kind === 'title')
    expect(title).toBeDefined()
    expect(title!.anchor.exact).toBe('')
  })
})
