import { describe, expect, it } from 'vitest'
import {
  collapseUnchanged,
  diffStats,
  lineDiff,
  type DiffLine,
} from '../lib/lineDiff'

/** Compact rendering, so an expectation reads like the diff it describes. */
const render = (lines: DiffLine[]): string[] =>
  lines.map(
    line =>
      `${line.op === 'added' ? '+' : line.op === 'removed' ? '-' : ' '}${line.text}`,
  )

describe('lineDiff', () => {
  it('reports nothing changed for identical text', () => {
    const lines = lineDiff('one\ntwo', 'one\ntwo')
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0 })
    expect(lines.every(line => line.op === 'same')).toBe(true)
  })

  it('marks a replaced line as removed then added', () => {
    expect(render(lineDiff('one\ntwo\nthree', 'one\nTWO\nthree'))).toEqual([
      ' one',
      '-two',
      '+TWO',
      ' three',
    ])
  })

  it('keeps the surviving lines around an insertion', () => {
    expect(render(lineDiff('a\nc', 'a\nb\nc'))).toEqual([' a', '+b', ' c'])
  })

  it('handles a deletion at the end', () => {
    expect(render(lineDiff('a\nb\nc', 'a'))).toEqual([' a', '-b', '-c'])
  })

  it('treats an empty document as everything added', () => {
    expect(render(lineDiff('', 'a\nb'))).toEqual(['-', '+a', '+b'])
  })

  it('finds the common subsequence rather than pairing lines up in order', () => {
    // Naive line-by-line comparison would call all four of these changed.
    const lines = lineDiff('a\nb\nc\nd', 'a\nx\nc\nd')
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1 })
  })

  it('counts what it added and removed', () => {
    expect(diffStats(lineDiff('a\nb\nc', 'a\nx\ny\nc'))).toEqual({
      added: 2,
      removed: 1,
    })
  })
})

describe('collapseUnchanged', () => {
  it('folds long untouched runs but keeps context around a change', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n')
    const after = ['a', 'b', 'c', 'd', 'CHANGED', 'f', 'g', 'h'].join('\n')

    const rows = collapseUnchanged(lineDiff(before, after), 1)

    expect(rows[0]).toEqual({ op: 'gap', count: 3 })
    expect(rows.slice(1, 4)).toEqual([
      { op: 'same', text: 'd' },
      { op: 'removed', text: 'e' },
      { op: 'added', text: 'CHANGED' },
    ])
    expect(rows.at(-1)).toEqual({ op: 'gap', count: 2 })
  })

  it('folds the whole thing away when nothing changed', () => {
    const rows = collapseUnchanged(lineDiff('a\nb\nc', 'a\nb\nc'))
    expect(rows).toEqual([{ op: 'gap', count: 3 }])
  })

  it('leaves a short diff alone', () => {
    const rows = collapseUnchanged(lineDiff('a', 'b'))
    expect(rows).toEqual([
      { op: 'removed', text: 'a' },
      { op: 'added', text: 'b' },
    ])
  })
})
