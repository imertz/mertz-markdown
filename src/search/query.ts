import { normalizeProject, normalizeTag } from '../lib/labels'

export interface ParsedSearchQuery {
  /** The clean search term with project: and tag: / #tag directives removed. */
  term: string
  /** Extracted project filter, or undefined if no project directive was in the query. null means unfiled. */
  project?: string | null
  /** Extracted tag filters. */
  tags: string[]
}

/**
 * Parse a search query string to extract `project:` and `tag:` or `#tag` directives.
 *
 * Supported formats:
 * - `project:Name` or `project:"Multiple Words"`
 * - `project:none`, `project:unfiled`, `project:null` -> project: null (unfiled)
 * - `tag:Name` or `tag:"Multiple Words"`
 * - `#tagName`
 *
 * Examples:
 * - `table notes project:work #gfm` -> term: "table notes", project: "work", tags: ["gfm"]
 * - `project:"Design System" #v1 #wip button` -> term: "button", project: "Design System", tags: ["v1", "wip"]
 * - `project:unfiled #draft` -> term: "", project: null, tags: ["draft"]
 */
export function parseSearchQuery(input: string): ParsedSearchQuery {
  if (!input || !input.trim()) {
    return { term: '', tags: [] }
  }

  let project: string | null | undefined = undefined
  const tags: string[] = []
  const terms: string[] = []

  const regex =
    /(?:project:(?:"([^"]+)"|'([^']+)'|(\S+)))|(?:tag:(?:"([^"]+)"|'([^']+)'|(\S+)))|(?:#([a-zA-Z0-9_\-\u00C0-\u024F\u0370-\u03FF\u1F00-\u1FFF]+))|("([^"]+)"|'([^']+)'|\S+)/gi

  let match: RegExpExecArray | null
  while ((match = regex.exec(input)) !== null) {
    const full = match[0]
    if (full.toLowerCase().startsWith('project:')) {
      const val = (match[1] ?? match[2] ?? match[3] ?? '').trim()
      const lower = val.toLowerCase()
      if (
        lower === 'none' ||
        lower === 'unfiled' ||
        lower === 'null' ||
        lower === '""' ||
        lower === "''"
      ) {
        project = null
      } else {
        project = normalizeProject(val)
      }
    } else if (full.toLowerCase().startsWith('tag:')) {
      const val = (match[4] ?? match[5] ?? match[6] ?? '').trim()
      const cleanTag = normalizeTag(val)
      if (
        cleanTag &&
        !tags.some(t => t.toLowerCase() === cleanTag.toLowerCase())
      ) {
        tags.push(cleanTag)
      }
    } else if (match[7] !== undefined) {
      const cleanTag = normalizeTag(match[7])
      if (
        cleanTag &&
        !tags.some(t => t.toLowerCase() === cleanTag.toLowerCase())
      ) {
        tags.push(cleanTag)
      }
    } else {
      const termVal = (match[8] ?? match[9] ?? match[10] ?? match[0] ?? '').trim()
      if (termVal) {
        terms.push(termVal)
      }
    }
  }

  return {
    term: terms.join(' '),
    ...(project !== undefined ? { project } : {}),
    tags,
  }
}
