import { describe, expect, it } from 'vitest'
import { flattenSubtree } from '../search/flatten'
import { collectPassages } from '../search/passages'
import { createTestEditor } from './editorHarness'
import { makeDocument } from './dbHarness'

/** Passages for a markdown fixture, excluding the synthetic title record. */
const bodyOf = (markdown: string, overrides = {}) => {
  const editor = createTestEditor(markdown)
  const record = makeDocument({
    doc: editor.getJSON(),
    title: 'Fixture',
    ...overrides,
  })
  return collectPassages(record).filter(passage => passage.kind !== 'title')
}

const textsOf = (markdown: string) => bodyOf(markdown).map(passage => passage.text)

describe('flattenSubtree', () => {
  it('joins adjacent text runs without a separator', () => {
    // Two text nodes with different marks are still one uninterrupted run.
    const node = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'plain' },
      ],
    }
    expect(flattenSubtree(node)).toBe('boldplain')
  })

  it('separates text across a block boundary', () => {
    const node = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    }
    expect(flattenSubtree(node)).toBe('one\ntwo')
  })

  it('separates text across an inline node, not just a block', () => {
    // The case that breaks naive concatenation, and the reason anchors quote
    // only the first run.
    const node = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'image', attrs: { src: 'x.png' } },
        { type: 'text', text: ' world' },
      ],
    }
    expect(flattenSubtree(node)).toBe('hello \n world')
  })

  it('emits no leading separator before the first run', () => {
    const node = {
      type: 'paragraph',
      content: [
        { type: 'image', attrs: { src: 'x.png' } },
        { type: 'text', text: 'after' },
      ],
    }
    expect(flattenSubtree(node)).toBe('after')
  })
})

describe('collectPassages', () => {
  it('emits one passage per paragraph', () => {
    expect(textsOf('First para.\n\nSecond para.')).toEqual([
      'First para.',
      'Second para.',
    ])
  })

  it('emits one passage per list item, not one per list', () => {
    const passages = bodyOf('- Alpha item\n- Beta item')
    expect(passages.map(p => p.text)).toEqual(['Alpha item', 'Beta item'])
    expect(passages.every(p => p.kind === 'listItem')).toBe(true)
  })

  it('emits one passage per table row', () => {
    const passages = bodyOf(
      ['| Name | Role |', '| --- | --- |', '| Ada | Engineer |'].join('\n'),
    )
    expect(passages.every(p => p.kind === 'tableRow')).toBe(true)
    expect(passages.map(p => p.text)).toEqual(['Name Role', 'Ada Engineer'])
  })

  it('skips blocks with no text of their own', () => {
    // An empty paragraph is a real node but nothing anyone can search for.
    expect(textsOf('Real text.\n\n\n\nMore text.')).toEqual([
      'Real text.',
      'More text.',
    ])
  })

  it('carries the enclosing headings on each passage', () => {
    const passages = bodyOf(
      ['# Guide', '', '## Tables', '', 'Alignment lives in the delimiter row.'].join('\n'),
    )
    const body = passages.find(p => p.text.startsWith('Alignment'))
    expect(body?.headingPath).toBe('Guide › Tables')
  })

  it('does not make a heading its own ancestor', () => {
    const passages = bodyOf('# Guide\n\nBody text.')
    const heading = passages.find(p => p.kind === 'heading')
    expect(heading?.headingPath).toBe('')
  })

  it('pops back out of a deeper heading level', () => {
    const passages = bodyOf(
      ['# One', '', '## Two', '', 'Under two.', '', '# Three', '', 'Under three.'].join(
        '\n',
      ),
    )
    expect(passages.find(p => p.text === 'Under two.')?.headingPath).toBe('One › Two')
    expect(passages.find(p => p.text === 'Under three.')?.headingPath).toBe('Three')
  })

  it('collapses whitespace in the readable text but not in the anchor', () => {
    const passages = bodyOf('hello ![](x.png) world')
    // The reader sees one line; the anchor still quotes exactly what the
    // flattener produces, which is what resolveSelector will look for.
    expect(passages[0].text).toBe('hello world')
    expect(passages[0].anchor.exact).toBe('hello ')
  })

  it('always emits exactly one title record', () => {
    const editor = createTestEditor('# Heading\n\nBody.')
    const record = makeDocument({ doc: editor.getJSON(), title: 'The Title' })
    const titles = collectPassages(record).filter(p => p.kind === 'title')

    expect(titles).toHaveLength(1)
    expect(titles[0].text).toBe('The Title')
  })

  it('marks every passage of a trashed document', () => {
    const passages = bodyOf('Some text.', { deletedAt: Date.now() })
    expect(passages.every(p => p.trashed)).toBe(true)
  })

  it('produces stable ids scoped to the document', () => {
    const editor = createTestEditor('One.\n\nTwo.')
    const record = makeDocument({ doc: editor.getJSON() })
    const ids = collectPassages(record).map(p => p.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => id.startsWith(`${record.id}#`))).toBe(true)
  })

  it('indexes code blocks, which are often what you are looking for', () => {
    const passages = bodyOf('```ts\nconst answer = 42\n```')
    expect(passages[0].kind).toBe('codeBlock')
    expect(passages[0].text).toBe('const answer = 42')
  })
})
