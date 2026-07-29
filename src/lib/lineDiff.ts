export type DiffOp = 'same' | 'added' | 'removed'

export interface DiffLine {
  op: DiffOp
  text: string
}

/**
 * Above this the quadratic table stops being worth allocating — 4M cells is
 * 16 MB as a Uint32Array, and two documents that differ by more than a
 * 2000-line core have nothing useful to say to each other line by line.
 */
const MAX_CELLS = 4_000_000

/**
 * Line diff of two markdown strings.
 *
 * Markdown rather than the ProseMirror JSON on purpose: JSON diffs at the
 * shape of the tree, which reports a paragraph gaining a mark as a wholesale
 * rewrite. The markdown is derived from the same document and is what the user
 * would recognise as "what it said".
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')

  // An edit touches a paragraph, not a document, so the matching runs at both
  // ends are usually most of it — and trimming them keeps the quadratic core
  // small enough to be free.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1

  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1
  }

  return [
    ...a.slice(0, head).map(text => ({ op: 'same' as const, text })),
    ...diffCore(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...a.slice(a.length - tail).map(text => ({ op: 'same' as const, text })),
  ]
}

function diffCore(a: string[], b: string[]): DiffLine[] {
  const removed = () => a.map(text => ({ op: 'removed' as const, text }))
  const added = () => b.map(text => ({ op: 'added' as const, text }))

  if (a.length === 0) return added()
  if (b.length === 0) return removed()
  // Pairing lines up across two documents this different would be invention;
  // saying one replaced the other is the honest answer.
  if (a.length * b.length > MAX_CELLS) return [...removed(), ...added()]

  // table[i][j] = length of the longest common subsequence of a[i…] and b[j…].
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ op: 'same', text: a[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      // Ties go to `removed`, so a replaced line reads as removed-then-added
      // rather than the other way round.
      lines.push({ op: 'removed', text: a[i] })
      i += 1
    } else {
      lines.push({ op: 'added', text: b[j] })
      j += 1
    }
  }

  for (; i < a.length; i += 1) lines.push({ op: 'removed', text: a[i] })
  for (; j < b.length; j += 1) lines.push({ op: 'added', text: b[j] })

  return lines
}

/** A run of unchanged lines the view folded away. */
export interface DiffGap {
  op: 'gap'
  count: number
}

export type DiffRow = DiffLine | DiffGap

/**
 * Fold long runs of untouched lines away, keeping `context` either side of
 * every change.
 *
 * Without this a one-word fix in a long document renders as a page of
 * identical lines with the change somewhere in it — technically the diff, but
 * useless for the question the panel exists to answer.
 */
export function collapseUnchanged(
  lines: readonly DiffLine[],
  context = 2,
): DiffRow[] {
  const keep = new Array<boolean>(lines.length).fill(false)

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].op === 'same') continue
    const start = Math.max(0, i - context)
    const end = Math.min(lines.length - 1, i + context)
    for (let j = start; j <= end; j += 1) keep[j] = true
  }

  const rows: DiffRow[] = []
  let folded = 0

  for (let i = 0; i < lines.length; i += 1) {
    if (!keep[i]) {
      folded += 1
      continue
    }
    if (folded) {
      rows.push({ op: 'gap', count: folded })
      folded = 0
    }
    rows.push(lines[i])
  }

  if (folded) rows.push({ op: 'gap', count: folded })
  return rows
}

/** How many lines a diff adds and removes, for a one-line summary. */
export function diffStats(lines: readonly DiffLine[]): {
  added: number
  removed: number
} {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.op === 'added') added += 1
    else if (line.op === 'removed') removed += 1
  }
  return { added, removed }
}
