import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The index is derived from IndexedDB, and stays correct only because every
 * document write goes through `useDocuments`, which reindexes alongside it.
 *
 * A write from anywhere else would not throw, would not fail a type check, and
 * would not show up in any other test — search would simply start returning
 * stale text for that document, quietly and forever. So pin the choke point
 * itself, the same way `schema-lock.test.ts` greps the source for direct
 * markdown-export calls to protect `toMarkdown`.
 *
 * Note for anyone editing this file: `schema-lock.test.ts` greps every source
 * file for that call, so naming it literally here — even inside a comment —
 * fails that test. Two source-grepping guards in one tree have to stay out of
 * each other's way.
 */

const SRC = join(import.meta.dirname, '..')

/** Functions that write a document record and therefore invalidate the index. */
const WRITERS = [
  'putDocument(',
  'putDocumentWithAssets(',
  'softDeleteDocument(',
  'restoreDocument(',
  'deleteDocumentCascade(',
]

/**
 * `src/db` defines them, `useDocuments` is the sanctioned caller, and the tests
 * and search store legitimately drive them directly to set up or verify state.
 */
const ALLOWED = [
  join('db', 'documents.ts'),
  join('db', 'assets.ts'),
  join('hooks', 'useDocuments.ts'),
  `test${sep}`,
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

describe('search index cannot silently diverge from the database', () => {
  it('routes every document write through useDocuments', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(SRC)) {
      const path = relative(SRC, file)
      if (ALLOWED.some(allowed => path.includes(allowed))) continue

      const source = readFileSync(file, 'utf8')
      for (const writer of WRITERS) {
        if (source.includes(writer)) offenders.push(`${path} → ${writer})`)
      }
    }

    expect(
      offenders,
      'These write a document without reindexing. Route them through ' +
        'useDocuments, or reindex explicitly and add them to ALLOWED.',
    ).toEqual([])
  })

  it('names writers that actually exist, so the guard cannot rot', () => {
    // A renamed writer would make every check above vacuously pass.
    const documents = readFileSync(join(SRC, 'db', 'documents.ts'), 'utf8')
    const assets = readFileSync(join(SRC, 'db', 'assets.ts'), 'utf8')
    const declared = documents + assets

    for (const writer of WRITERS) {
      const name = writer.slice(0, -1)
      expect(declared, `${name} is no longer defined`).toContain(
        `export async function ${name}`,
      )
    }
  })
})
