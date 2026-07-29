import type { JSONContent } from '@tiptap/core'

/**
 * Repairs inline-code fencing, which @tiptap/markdown gets wrong.
 *
 * `@tiptap/extension-code`'s renderMarkdown is `` `${renderChildren(content)}` ``
 * — always exactly one backtick. But MarkdownManager derives a mark's opening
 * and closing strings by rendering it around a *placeholder* and splitting the
 * result (see getMarkOpening), so the real content is never in scope when the
 * fence is chosen.
 *
 * For content containing a backtick that produces broken, non-idempotent
 * output: `` ``a ` b`` `` serialises to `` `a ` b` ``, which re-parses as the
 * code span "a" followed by literal text, and a second save then mangles it
 * further. That is silent content corruption, so it is repaired here rather
 * than accepted.
 */

/**
 * CommonMark §6.1: the delimiter must be a backtick run longer than any run
 * inside the content, and a space is stripped from each end when the content
 * both starts and ends with one.
 */
export function fenceCodeSpan(content: string): string {
  const longestRun = (content.match(/`+/g) ?? []).reduce(
    (max, run) => Math.max(max, run.length),
    0,
  )
  const fence = '`'.repeat(longestRun + 1)
  const pad = needsPadding(content) ? ' ' : ''
  return `${fence}${pad}${content}${pad}${fence}`
}

function needsPadding(content: string): boolean {
  // A leading/trailing backtick would otherwise merge into the fence.
  if (content.startsWith('`') || content.endsWith('`')) return true
  // A space at both ends would be eaten by the parser on the way back in.
  return (
    content.startsWith(' ') && content.endsWith(' ') && content.trim() !== ''
  )
}

/** True when the default single-backtick fence would not round-trip. */
function needsRepair(content: string): boolean {
  return content.includes('`') || needsPadding(content)
}

/** Text of every code-marked run, in document order. */
export function collectCodeSpanContents(doc: JSONContent): string[] {
  const contents: string[] = []

  const walk = (node: JSONContent): void => {
    if (
      node.type === 'text' &&
      typeof node.text === 'string' &&
      node.marks?.some(mark => mark.type === 'code')
    ) {
      contents.push(node.text)
    }
    // Code blocks are fenced separately and must not be touched.
    if (node.type === 'codeBlock') return
    for (const child of node.content ?? []) walk(child)
  }

  walk(doc)
  return contents
}

/**
 * Re-fence any code span the serializer under-delimited. Scans forward through
 * the output in document order so repeated identical spans each get repaired
 * exactly once.
 */
export function repairCodeSpans(markdown: string, doc: JSONContent): string {
  let result = markdown
  let cursor = 0

  for (const content of collectCodeSpanContents(doc)) {
    if (!needsRepair(content)) continue

    const emitted = `\`${content}\``
    const index = result.indexOf(emitted, cursor)
    if (index === -1) continue

    const repaired = fenceCodeSpan(content)
    result =
      result.slice(0, index) + repaired + result.slice(index + emitted.length)
    cursor = index + repaired.length
  }

  return result
}
