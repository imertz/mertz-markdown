import type { SyncObjectKind } from '../types'
import type {
  ChangesResponse,
  PairingClaimResponse,
  UploadResponse,
  VaultDevice,
  VaultUsage,
} from './types'

interface ClientOptions {
  apiUrl: string
  vaultId?: string
  token?: string
}

/**
 * A sync request that the server refused.
 *
 * Carries the status so callers can tell a permanent answer about one object
 * (404: the revision has no body) from a transient failure that must not be
 * treated as a verdict.
 */
export class SyncRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'SyncRequestError'
  }
}

export class SyncApiClient {
  private readonly apiUrl: string
  private readonly vaultId?: string
  private readonly token?: string

  constructor({ apiUrl, vaultId, token }: ClientOptions) {
    this.apiUrl = apiUrl.replace(/\/$/, '')
    this.vaultId = vaultId
    this.token = token
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    const response = await fetch(`${this.apiUrl}/v1${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    })
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new SyncRequestError(
        message || `Sync request failed (${response.status})`,
        response.status,
      )
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  private vaultPath(suffix = ''): string {
    if (!this.vaultId) throw new Error('Vault id is required')
    return `/vaults/${encodeURIComponent(this.vaultId)}${suffix}`
  }

  createVault(deviceLabel: string): Promise<{
    vaultId: string
    deviceId: string
    deviceToken: string
    serverTime: number
  }> {
    return this.request('/vaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceLabel }),
    })
  }

  time(): Promise<{ serverTime: number }> {
    return this.request('/time')
  }

  changes(after: number): Promise<ChangesResponse> {
    return this.request(this.vaultPath(`/changes?after=${after}`))
  }

  async getObject(
    kind: SyncObjectKind,
    objectId: string,
    revision?: number,
  ): Promise<Uint8Array> {
    const suffix = revision == null ? '' : `?revision=${revision}`
    const headers = new Headers()
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    const response = await fetch(
      `${this.apiUrl}/v1${this.vaultPath(`/objects/${kind}/${encodeURIComponent(objectId)}${suffix}`)}`,
      { headers, cache: 'no-store' },
    )
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new SyncRequestError(
        message || `Sync request failed (${response.status})`,
        response.status,
      )
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  async putObject(
    kind: SyncObjectKind,
    objectId: string,
    docId: string,
    ciphertext: Uint8Array,
    baseRevision: number,
    changedAt: number,
    operation: 'put' | 'delete',
    deviceLabel: string,
  ): Promise<UploadResponse> {
    return this.request(
      this.vaultPath(`/objects/${kind}/${encodeURIComponent(objectId)}`),
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Document-Id': docId,
          'X-Base-Revision': String(baseRevision),
          'X-Changed-At': String(changedAt),
          'X-Sync-Operation': operation,
          'X-Device-Label': deviceLabel,
        },
        body: ciphertext as BodyInit,
      },
    )
  }

  createPairing(payload: {
    pairingId: string
    tokenHash: string
    wrappedKey: string
    expiresAt: number
  }): Promise<void> {
    return this.request(this.vaultPath('/pairings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  claimPairing(
    vaultId: string,
    pairingId: string,
    token: string,
    deviceLabel: string,
  ): Promise<PairingClaimResponse> {
    return this.request(
      `/vaults/${encodeURIComponent(vaultId)}/pairings/${encodeURIComponent(pairingId)}/claim`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, deviceLabel }),
      },
    )
  }

  devices(): Promise<{ devices: VaultDevice[]; usage?: VaultUsage }> {
    return this.request(this.vaultPath('/devices'))
  }

  revokeDevice(deviceId: string): Promise<void> {
    return this.request(this.vaultPath(`/devices/${encodeURIComponent(deviceId)}`), {
      method: 'DELETE',
    })
  }
}
