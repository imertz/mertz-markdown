import { describe, expect, it } from 'vitest'
import { collectAnchoredThreadIds } from '../editor/extensions/comment'
import { buildSelector } from '../markdown/anchors'
import { toMarkdown } from '../markdown/export'
import { reanchorThreads, titleFromFilename } from '../markdown/import'
import type { ThreadWithComments } from '../types'
import { createTestEditor, rangeOfText } from './editorHarness'

const SOURCE = [
  '# Release plan',
  '',
  'The parser rewrite should land by Q3, and the table work follows.',
  '',
  '- Benchmark large files',
  '- Audit table edge cases',
  '',
].join('\n')

const threadFrom = (
  id: string,
  editor: ReturnType<typeof createTestEditor>,
  needle: string,
): ThreadWithComments => {
  const { from, to } = rangeOfText(editor, needle)
  return {
    id,
    docId: 'doc-1',
    status: 'open',
    selector: buildSelector(editor.state.doc, from, to),
    createdAt: 0,
    updatedAt: 0,
    resolvedAt: null,
    orphanedAt: null,
    comments: [],
  }
}

describe('export', () => {
  it('leaves no trace of comments in the exported markdown', () => {
    const clean = createTestEditor(SOURCE)
    const expected = toMarkdown(clean)

    const annotated = createTestEditor(SOURCE)
    annotated.commands.setTextSelection(rangeOfText(annotated, 'parser rewrite'))
    annotated.commands.setComment('t1')
    annotated.commands.setTextSelection(rangeOfText(annotated, 'table work'))
    annotated.commands.setComment('t2')

    const exported = toMarkdown(annotated)

    expect(exported).toBe(expected)
    expect(exported).not.toContain('data-comment')
    expect(exported).not.toContain('t1')
    expect(exported).not.toMatch(/<[a-z][^>]*>/i)

    clean.destroy()
    annotated.destroy()
  })
})

describe('re-import', () => {
  it('re-anchors threads from their text-quote selectors', () => {
    // Build selectors against an annotated document…
    const original = createTestEditor(SOURCE)
    const threads = [
      threadFrom('t1', original, 'parser rewrite'),
      threadFrom('t2', original, 'Audit table edge cases'),
    ]
    const exported = toMarkdown(original)
    original.destroy()

    // …then re-open the plain .md, which cannot carry any anchors.
    const reopened = createTestEditor(exported)
    expect(collectAnchoredThreadIds(reopened.state.doc)).toEqual(new Set())

    const result = reanchorThreads(reopened, threads)

    expect(result.reanchored.sort()).toEqual(['t1', 't2'])
    expect(result.orphaned).toEqual([])
    expect(collectAnchoredThreadIds(reopened.state.doc)).toEqual(
      new Set(['t1', 't2']),
    )
    // And the markdown is still untouched by the re-anchoring.
    expect(toMarkdown(reopened)).toBe(exported)

    reopened.destroy()
  })

  it('reports threads whose quoted text is gone as orphaned', () => {
    const original = createTestEditor(SOURCE)
    const threads = [
      threadFrom('t1', original, 'parser rewrite'),
      threadFrom('gone', original, 'Benchmark large files'),
    ]
    original.destroy()

    const withoutBenchmark = SOURCE.replace('- Benchmark large files\n', '')
    const reopened = createTestEditor(withoutBenchmark)

    const result = reanchorThreads(reopened, threads)

    expect(result.reanchored).toEqual(['t1'])
    expect(result.orphaned).toEqual(['gone'])
    reopened.destroy()
  })

  it('picks the occurrence matching the recorded context when text repeats', () => {
    const repeated = 'alpha target omega\n\nbravo target zulu\n'
    const editor = createTestEditor(repeated)

    // Anchor the SECOND "target", the one preceded by "bravo".
    let secondFrom = -1
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      const index = node.text.indexOf('bravo target')
      if (index !== -1) secondFrom = pos + index + 'bravo '.length
    })
    expect(secondFrom).toBeGreaterThan(-1)

    const thread: ThreadWithComments = {
      id: 'ctx',
      docId: 'doc-1',
      status: 'open',
      selector: buildSelector(
        editor.state.doc,
        secondFrom,
        secondFrom + 'target'.length,
      ),
      createdAt: 0,
      updatedAt: 0,
      resolvedAt: null,
      orphanedAt: null,
      comments: [],
    }
    editor.destroy()

    const reopened = createTestEditor(repeated)
    reanchorThreads(reopened, [thread])

    // The mark must land on the second occurrence, not the first.
    const marked: string[] = []
    reopened.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      if (node.marks.some(mark => mark.type.name === 'comment')) {
        marked.push(`${pos}`)
        const context = reopened.state.doc.textBetween(
          Math.max(0, pos - 7),
          pos,
          ' ',
          ' ',
        )
        expect(context).toContain('bravo')
      }
    })
    expect(marked).toHaveLength(1)

    reopened.destroy()
  })
})

describe('titleFromFilename', () => {
  it('strips the extension and tidies separators', () => {
    expect(titleFromFilename('release-plan.md')).toBe('release plan')
    expect(titleFromFilename('design_doc.markdown')).toBe('design doc')
    expect(titleFromFilename('notes')).toBe('notes')
  })
})
