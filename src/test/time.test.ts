import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatBytes, relative } from '../lib/time'

const NOW = new Date('2026-07-29T12:00:00Z').getTime()

const ago = (ms: number): string => relative(NOW - ms)

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

afterEach(() => {
  vi.useRealTimers()
})

describe('relative', () => {
  it('reports each unit at its own scale', () => {
    vi.useFakeTimers({ now: NOW })

    expect(ago(0)).toBe('just now')
    expect(ago(30 * SECOND)).toBe('just now')
    expect(ago(5 * MINUTE)).toBe('5m ago')
    expect(ago(3 * HOUR)).toBe('3h ago')
    expect(ago(2 * DAY)).toBe('2d ago')
  })

  it('changes unit at each boundary', () => {
    vi.useFakeTimers({ now: NOW })

    expect(ago(59 * SECOND)).toBe('just now')
    expect(ago(MINUTE)).toBe('1m ago')
    expect(ago(59 * MINUTE)).toBe('59m ago')
    expect(ago(HOUR)).toBe('1h ago')
    expect(ago(23 * HOUR)).toBe('23h ago')
    expect(ago(DAY)).toBe('1d ago')
  })

  it('does not go negative for a timestamp in the future', () => {
    vi.useFakeTimers({ now: NOW })

    // Clock skew between a write and a read should read as "just now", not
    // "-1m ago".
    expect(relative(NOW + 10 * SECOND)).toBe('just now')
  })
})

describe('formatBytes', () => {
  it('handles nothing and nonsense without producing NaN', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })

  it('never shows a fraction of a byte', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(999)).toBe('999 B')
  })

  it('steps up in decimal units, as the browser reports them', () => {
    expect(formatBytes(1000)).toBe('1.0 KB')
    expect(formatBytes(1_500_000)).toBe('1.5 MB')
    expect(formatBytes(2_000_000_000)).toBe('2.0 GB')
  })

  it('drops the decimal once three digits make it noise', () => {
    expect(formatBytes(123_000)).toBe('123 KB')
  })
})
