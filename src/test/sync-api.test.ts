import { afterEach, describe, expect, it, vi } from 'vitest'
import { SyncApiClient } from '../sync/api'

afterEach(() => vi.unstubAllGlobals())

describe('sync registration API', () => {
  it('creates an anonymous vault without a setup credential', async () => {
    const fetch_ = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          vaultId: 'vault-id',
          deviceId: 'device-id',
          deviceToken: 'device-token',
          serverTime: 1,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch_)

    await new SyncApiClient({ apiUrl: 'https://sync.example' }).createVault('Safari')

    const [url, init] = fetch_.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(url).toBe('https://sync.example/v1/vaults')
    expect(headers.get('X-Setup-Token')).toBeNull()
    expect(JSON.parse(String(init.body))).toEqual({ deviceLabel: 'Safari' })
  })
})
