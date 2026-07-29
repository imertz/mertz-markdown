import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { HtmlRenderer, Parser } from 'commonmark'
import { describe, expect, it } from 'vitest'
import {
  createMarkdownManager,
  serializeWithManager,
} from '../markdown/manager'

const FIXTURE_DIR = join(import.meta.dirname, 'fixtures', 'commonmark')

const manager = createMarkdownManager()
const reader = new Parser()
const writer = new HtmlRenderer()

/** Render with the CommonMark REFERENCE implementation, not our own parser. */
const referenceHtml = (markdown: string): string =>
  writer.render(reader.parse(markdown))

const roundTrip = (markdown: string): string =>
  serializeWithManager(manager, manager.parse(markdown))

/**
 * GFM constructs the reference CommonMark renderer does not implement — it
 * renders `~~x~~`, `- [ ]` and pipe tables as plain text, so comparing our
 * output to its rendering says nothing. Idempotence and the no-HTML guarantee
 * still apply to them below, which is what actually protects the file format.
 */
const GFM_ONLY = new Set([
  'gfm-strike.md',
  'gfm-task-list.md',
  'gfm-table.md',
  'gfm-table-align.md',
  'gfm-table-empty-cells.md',
  'gfm-table-inline.md',
])

/**
 * KNOWN SCHEMA LIMITATION — loose lists are normalised to tight.
 *
 * CommonMark distinguishes a "loose" list (items separated by a blank line,
 * each item's content wrapped in <p>) from a "tight" one. ProseMirror's list
 * schema has no such distinction: both parse to listItem > paragraph, so the
 * blank lines are gone by the time we serialize.
 *
 * No content is lost and the result is idempotent — only the <p> wrapper inside
 * <li> differs. These fixtures are therefore compared with that wrapper
 * normalised away, which still catches any real content regression.
 */
const TIGHTENS_LISTS = new Set(['loose-list.md', 'list-with-code.md'])

const unwrapListItemParagraphs = (html: string): string =>
  html
    .replace(/<li>\s*<p>([\s\S]*?)<\/p>/g, '<li>$1')
    // Loose items sit on their own lines; collapse the renderer's line breaks
    // so the comparison is about structure rather than formatting. Applied to
    // both sides equally, so a genuine content difference still fails.
    .replace(/>\s+</g, '><')
    .replace(/\s+<\//g, '</')
    .trim()

const fixtures = readdirSync(FIXTURE_DIR)
  .filter(name => name.endsWith('.md'))
  .sort()
  .map(name => [name, readFileSync(join(FIXTURE_DIR, name), 'utf8')] as const)

describe('CommonMark round-trip corpus', () => {
  it('found the fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(30)
  })

  for (const [name, source] of fixtures) {
    describe(name, () => {
      const once = roundTrip(source)

      if (!GFM_ONLY.has(name)) {
        it('is semantically unchanged', () => {
          // Byte equality is the wrong assertion: the serializer legitimately
          // normalises (setext -> ATX, _em_ -> *em*) and over-escapes
          // (snake_case -> snake\_case). Both render identically, and the
          // reference implementation is the arbiter of that.
          const normalize = TIGHTENS_LISTS.has(name)
            ? unwrapListItemParagraphs
            : (html: string) => html

          expect(normalize(referenceHtml(once))).toBe(
            normalize(referenceHtml(source)),
          )
        })
      }

      it('is idempotent', () => {
        // Without this, every save silently rewrites the file and pollutes diffs.
        expect(roundTrip(once)).toBe(once)
      })

      it('emits no raw HTML or entities', () => {
        // The mechanical enforcement of the spec-compatibility requirement.
        expect(once).not.toMatch(/<[a-z][^>]*>/i)
        expect(once).not.toMatch(/&[a-z]+;|&#\d+;/i)
        // ++text++ is Pandoc underline — neither CommonMark nor GFM.
        expect(once).not.toMatch(/\+\+/)
      })
    })
  }
})
