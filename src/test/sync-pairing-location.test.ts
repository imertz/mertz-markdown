import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  history.replaceState(null, '', '/')
  vi.resetModules()
})

describe('pairing-link location handling', () => {
  it('scrubs fragment secrets as soon as the module loads and consumes them once', async () => {
    history.replaceState(
      { navigation: 'test' },
      '',
      '/v/abcdefghijklmnop?source=qr#p=pair-id.token-secret&w=wrap-secret',
    )

    const pairing = await import('../sync/pairingLocation')

    expect(location.pathname + location.search + location.hash).toBe(
      '/v/abcdefghijklmnop?source=qr',
    )
    expect(history.state).toEqual({ navigation: 'test' })
    expect(pairing.hasPendingPairingLocation()).toBe(true)
    expect(pairing.takePendingPairingLocation()).toEqual({
      vaultId: 'abcdefghijklmnop',
      pair: 'pair-id.token-secret',
      wrap: 'wrap-secret',
    })
    expect(pairing.takePendingPairingLocation()).toBeNull()
  })

  it('also scrubs malformed fragments without retaining them', async () => {
    history.replaceState(null, '', '/v/abcdefghijklmnop#p=incomplete')

    const pairing = await import('../sync/pairingLocation')

    expect(location.hash).toBe('')
    expect(pairing.hasPendingPairingLocation()).toBe(false)
  })
})
