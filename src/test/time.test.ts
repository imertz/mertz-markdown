import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatBytes, relative, scaled } from '../lib/time'

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

describe('scaled', () => {
  // The formats themselves belong to the reader's locale, so these compare
  // against the same Intl call rather than against a spelling of our own — the
  // choice of *which* format is what this file is responsible for.
  const stamp = new Date(2026, 6, 29, 14, 5, 0).getTime()

  it('gives the hour under a heading that already said the day', () => {
    expect(scaled(stamp, 'clock')).toBe(
      new Date(stamp).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }),
    )
  })

  it('gives the weekday inside the last seven days', () => {
    expect(scaled(stamp, 'weekday')).toBe(
      new Date(stamp).toLocaleDateString(undefined, { weekday: 'short' }),
    )
  })

  it('gives a day and month for anything older', () => {
    expect(scaled(stamp, 'date', stamp)).toBe(
      new Date(stamp).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      }),
    )
  })

  it('reaches for the year only when it is not this one', () => {
    const lastYear = new Date(2025, 2, 4, 9, 0, 0).getTime()

    // The year is only worth its width when its absence would be ambiguous.
    expect(scaled(lastYear, 'date', stamp)).toBe(
      new Date(lastYear).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      }),
    )
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
