import type { JSONContent } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { buildResolvedExtensions } from '../editor/extensions'
import { MARKED_OPTIONS } from './config'
import { finalizeMarkdown, normalizeDocForExport } from './export'

/**
 * A MarkdownManager detached from any Editor.
 *
 * It needs no DOM and no ProseMirror view, which is what lets the round-trip
 * corpus run as fast unit tests against exactly the extension list that ships.
 * The live editor gets its own instance from the Markdown extension.
 */
export function createMarkdownManager(): MarkdownManager {
  return new MarkdownManager({
    extensions: buildResolvedExtensions(),
    markedOptions: MARKED_OPTIONS,
  })
}

export function parseMarkdown(
  manager: MarkdownManager,
  markdown: string,
): JSONContent {
  return manager.parse(markdown)
}

/** Mirrors serializeDoc() in export.ts, minus the Editor dependency. */
export function serializeWithManager(
  manager: MarkdownManager,
  doc: JSONContent,
): string {
  const normalized = normalizeDocForExport(doc)
  return finalizeMarkdown(manager.serialize(normalized), normalized)
}
