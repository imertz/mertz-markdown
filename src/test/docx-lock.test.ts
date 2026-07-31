import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { MARK_HANDLING, NODE_HANDLING } from '../docx/document'
import { buildExtensions } from '../editor/extensions'
import { ALLOWED_MARKS, ALLOWED_NODES } from '../markdown/config'

const schema = getSchema(buildExtensions())

/**
 * The DOCX counterpart to schema-lock.test.ts, and it exists for the same
 * reason.
 *
 * `renderBlock` and `renderInlineNode` are switches with a `default` that
 * returns the empty string, so a node type nobody wrote a case for is dropped
 * from the exported file in silence — data loss wearing the costume of a
 * formatting difference. Adding a node to the schema without deciding how Word
 * should show it has to fail here rather than in a user's document.
 */
describe('docx handler lock', () => {
  it('accounts for every node in the schema', () => {
    expect(Object.keys(NODE_HANDLING).sort()).toEqual(
      Object.keys(schema.nodes).sort(),
    )
  })

  it('accounts for every mark in the schema', () => {
    expect(Object.keys(MARK_HANDLING).sort()).toEqual(
      Object.keys(schema.marks).sort(),
    )
  })

  it('stays in step with the markdown allowlists', () => {
    // Both exporters walk the same document. If one grows a node the other has
    // never heard of, they have diverged and one of them is losing content.
    expect(Object.keys(NODE_HANDLING).sort()).toEqual([...ALLOWED_NODES].sort())
    expect(Object.keys(MARK_HANDLING).sort()).toEqual([...ALLOWED_MARKS].sort())
  })

  it('keeps the comment mark invisible', () => {
    // The clean export's whole promise. `invisible` is a decision recorded in
    // the table; a mark simply missing from it would look the same in the
    // output and mean something entirely different.
    expect(MARK_HANDLING.comment).toBe('invisible')
  })

  it('classifies every node as something the walker can reach', () => {
    const reachable = new Set(['root', 'block', 'inline', 'parent'])
    for (const [name, handling] of Object.entries(NODE_HANDLING)) {
      expect(reachable.has(handling), `${name} has no handling`).toBe(true)
    }
  })
})
