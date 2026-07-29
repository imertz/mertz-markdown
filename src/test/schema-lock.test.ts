import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getExtensionField, getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { buildExtensions, buildResolvedExtensions } from '../editor/extensions'
import {
  ALLOWED_MARKS,
  ALLOWED_NODES,
  INVISIBLE_MARKS,
  PARENT_RENDERED_NODES,
} from '../markdown/config'

const schema = getSchema(buildExtensions())

// Resolved, not raw: StarterKit and TableKit are kits that expand into the
// individual nodes and marks, and it's those children that carry the markdown
// config. This is the same list MarkdownManager itself receives.
const resolved = buildResolvedExtensions()
const byName = new Map(resolved.map(extension => [extension.name, extension]))

const field = (name: string, key: 'renderMarkdown' | 'parseMarkdown' | 'markdownTokenName' | 'markdownTokenizer') => {
  const extension = byName.get(name)
  return extension ? getExtensionField(extension, key) : undefined
}

describe('schema lock', () => {
  it('contains no node outside the allowlist', () => {
    expect(Object.keys(schema.nodes).sort()).toEqual([...ALLOWED_NODES].sort())
  })

  it('contains no mark outside the allowlist', () => {
    expect(Object.keys(schema.marks).sort()).toEqual([...ALLOWED_MARKS].sort())
  })

  it('every node declares renderMarkdown, or is rendered by its parent', () => {
    // MarkdownManager.renderNodeToMarkdown returns '' for a node type it has no
    // handler for. An unvetted node is therefore dropped from export in
    // silence — data loss, not merely lost formatting.
    const exempt = new Set<string>(['doc', 'text', ...PARENT_RENDERED_NODES])
    const missing = Object.keys(schema.nodes).filter(
      name =>
        !exempt.has(name) && typeof field(name, 'renderMarkdown') !== 'function',
    )
    expect(missing).toEqual([])
  })

  it('parent-rendered nodes really are rendered by an ancestor', () => {
    // Keeps the carve-out above honest: if a future TipTap release gives these
    // their own renderer, the exemption is stale and should be removed.
    for (const name of PARENT_RENDERED_NODES) {
      expect(field(name, 'renderMarkdown'), `${name} now renders itself`).toBeUndefined()
    }
    // …and the ancestor that covers them does render.
    expect(typeof field('table', 'renderMarkdown')).toBe('function')
  })

  it('invisible marks declare no markdown syntax at all', () => {
    // The whole comments-are-sidecar design rests on this staying true.
    for (const name of INVISIBLE_MARKS) {
      expect(byName.get(name), `${name} is not in the schema`).toBeDefined()
      expect(
        field(name, 'renderMarkdown'),
        `${name} must not render markdown`,
      ).toBeUndefined()
      expect(field(name, 'markdownTokenName')).toBeUndefined()
      expect(field(name, 'markdownTokenizer')).toBeUndefined()
      expect(field(name, 'parseMarkdown')).toBeUndefined()
    }
  })

  it('does not include underline, which emits ++text++', () => {
    // Verified in @tiptap/extension-underline@3.29.2:
    //   renderMarkdown(node, helpers) { return `++${...}++` }
    // `++text++` is Pandoc-flavoured: neither CommonMark nor GFM.
    expect(schema.marks).not.toHaveProperty('underline')
  })

  it('keeps the comment mark non-inclusive and non-excluding', () => {
    const comment = schema.marks.comment
    expect(comment, 'comment mark missing from schema').toBeDefined()
    // inclusive:false — typing at an edge must not extend the anchor.
    expect(comment?.spec.inclusive).toBe(false)
    // excludes:'' — two threads must be able to overlap the same text.
    expect(comment?.spec.excludes).toBe('')
  })
})

describe('markdown export discipline', () => {
  it('routes every markdown export through src/markdown/export.ts', () => {
    // getMarkdown() skips normalizeDocForExport, so it re-introduces the
    // &nbsp; and trailing-paragraph artifacts that export.ts strips.
    // oxlint 1.76 has no no-restricted-syntax rule, so this is the enforcement.
    const offenders: string[] = []
    const srcRoot = join(import.meta.dirname, '..')

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.tsx?$/.test(entry)) continue
        if (full.endsWith(join('markdown', 'export.ts'))) continue
        if (full.endsWith(join('test', 'schema-lock.test.ts'))) continue
        if (readFileSync(full, 'utf8').includes('getMarkdown(')) {
          offenders.push(full.slice(srcRoot.length + 1))
        }
      }
    }
    walk(srcRoot)

    expect(offenders).toEqual([])
  })
})
