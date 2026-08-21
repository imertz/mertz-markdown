import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  history.replaceState(null, '', '/')
  vi.resetModules()
  vi.unstubAllGlobals()
})

/**
 * The iOS problem this exists for: a scanned pairing link always opens Safari,
 * a home-screen app has its own storage, and a pairing is one-shot — so the
 * browser holding the link has to be able to hand it back out again.
 */
describe('pairing links pasted rather than navigated to', () => {
  it('parses a full link and rejects anything that is not one', async () => {
    const { parsePairingLink } = await import('../sync/pairingLocation')

    expect(
      parsePairingLink(
        '  https://markdown.mysolon.gr/v/abcdefghijklmnop#p=pair-id.token-secret&w=wrap-secret ',
      ),
    ).toEqual({ vaultId: 'abcdefghijklmnop', pair: 'pair-id.token-secret', wrap: 'wrap-secret' })

    // Relative, as pasted out of a shared note.
    expect(parsePairingLink('/v/abcdefghijklmnop#p=a.b&w=c')).toEqual({
      vaultId: 'abcdefghijklmnop',
      pair: 'a.b',
      wrap: 'c',
    })

    expect(parsePairingLink('')).toBeNull()
    expect(parsePairingLink('not a link at all')).toBeNull()
    // The document, not an invitation to it: no fragment, nothing to claim.
    expect(parsePairingLink('https://markdown.mysolon.gr/v/abcdefghijklmnop')).toBeNull()
    // Half a fragment is not half a pairing.
    expect(parsePairingLink('/v/abcdefghijklmnop#p=a.b')).toBeNull()
  })

  it('round-trips through formatPairingLink', async () => {
    const { formatPairingLink, parsePairingLink } = await import('../sync/pairingLocation')
    const location = { vaultId: 'abcdefghijklmnop', pair: 'pair-id.token', wrap: 'wrap' }

    const link = formatPairingLink(location, 'https://example.test')
    expect(link).toBe('https://example.test/v/abcdefghijklmnop#p=pair-id.token&w=wrap')
    expect(parsePairingLink(link)).toEqual(location)
  })
})

describe('deciding whether a pairing has to be handed on', () => {
  const stubAgent = (userAgent: string, extra: Record<string, unknown> = {}) => {
    vi.stubGlobal('navigator', {
      userAgent,
      platform: 'iPhone',
      maxTouchPoints: 5,
      ...extra,
    })
  }

  const stubDisplayMode = (standalone: boolean) => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: standalone && query.includes('standalone'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
  }

  it('hands off in an iOS browser tab', async () => {
    stubAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Safari/605.1.15')
    stubDisplayMode(false)
    const { pairingNeedsHandoff } = await import('../sync/pairingLocation')
    expect(pairingNeedsHandoff()).toBe(true)
  })

  it('does not hand off inside the installed app, which is where it would land', async () => {
    stubAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Safari/605.1.15', {
      standalone: true,
    })
    stubDisplayMode(true)
    const { pairingNeedsHandoff } = await import('../sync/pairingLocation')
    expect(pairingNeedsHandoff()).toBe(false)
  })

  it('leaves every other platform claiming links where they open', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    })
    stubDisplayMode(false)
    const { pairingNeedsHandoff } = await import('../sync/pairingLocation')
    expect(pairingNeedsHandoff()).toBe(false)
  })

  it('treats iPadOS, which claims to be a Mac, as iOS', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })
    stubDisplayMode(false)
    const { pairingNeedsHandoff } = await import('../sync/pairingLocation')
    expect(pairingNeedsHandoff()).toBe(true)
  })
})
