import type { BuiltPublication, PublicationBundleV1 } from './bundle'
import type { BlogArticleState, BlogConnection } from './state'

export interface PublisherCapabilities {
  tags: boolean
  drafts: boolean
  captions: boolean
  imageDimensions: boolean
  imageAlignment: boolean
  imageCredit: boolean
  slug: 'client' | 'server' | false
  description: 'client' | 'server' | false
}

export interface ServerInfo {
  name: string
  version: string
  protocols: string[]
}

export interface SiteInfo {
  id: string
  name: string
  publisher: string
}

export interface PreflightResult {
  status: 'ready' | 'unchanged' | 'attention'
  action: 'create' | 'update' | 'adopt' | 'unpublish'
  preflightToken?: string
  requiredUploads: number[]
  capabilities: PublisherCapabilities
  attention?: {
    code: 'slug_taken' | 'slug_would_change'
    message: string
    from?: string
    to?: string
    remotePostId?: string
  }
  publication?: BlogArticleState
}

export interface PublicationResult {
  published: boolean
  publication: BlogArticleState
  uploaded: string[]
  warnings: string[]
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string }
}

export class PublishApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PublishApiError'
  }
}

function base(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Publishing server must use HTTPS')
  }
  return url.toString().replace(/\/$/, '')
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & ErrorEnvelope
  if (!response.ok) {
    throw new PublishApiError(
      body.error?.code ?? 'http_error',
      body.error?.message ?? `Publishing server answered HTTP ${response.status}`,
      response.status,
    )
  }
  return body
}

export class BlogApiClient {
  constructor(private readonly connection: BlogConnection) {}

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${this.connection.deviceToken}`)
    headers.set('accept', 'application/json')
    return fetch(`${base(this.connection.serverUrl)}${path}`, {
      ...init,
      headers,
    })
  }

  static async info(serverUrl: string): Promise<ServerInfo> {
    return responseJson(await fetch(`${base(serverUrl)}/v1/info`))
  }

  static async claim(
    serverUrl: string,
    code: string,
    deviceLabel: string,
  ): Promise<BlogConnection> {
    const claimed = await responseJson<{
      deviceId: string
      deviceToken: string
      sites: SiteInfo[]
    }>(
      await fetch(`${base(serverUrl)}/v1/pairing/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, deviceLabel }),
      }),
    )
    const site = claimed.sites[0]
    if (!site) throw new Error('The publishing device has no permitted site')
    return {
      serverUrl: base(serverUrl),
      deviceId: claimed.deviceId,
      deviceToken: claimed.deviceToken,
      siteId: site.id,
      siteName: site.name,
      connectedAt: Date.now(),
    }
  }

  async publication(documentId: string): Promise<BlogArticleState | null> {
    const query = new URLSearchParams({ siteId: this.connection.siteId })
    const response = await this.request(
      `/v1/documents/${encodeURIComponent(documentId)}/publication?${query}`,
    )
    if (response.status === 404) return null
    return (await responseJson<{ publication: BlogArticleState }>(response)).publication
  }

  async capabilities(): Promise<PublisherCapabilities> {
    const response = await this.request(
      `/v1/sites/${encodeURIComponent(this.connection.siteId)}/capabilities`,
    )
    return (await responseJson<{ capabilities: PublisherCapabilities }>(response))
      .capabilities
  }

  async disconnect(): Promise<void> {
    const response = await this.request('/v1/devices/current', {
      method: 'DELETE',
    })
    if (!response.ok) await responseJson(response)
  }

  async preflight(
    bundle: PublicationBundleV1,
    publicationHash: string,
    confirmation?: { allowSlugChange?: boolean },
  ): Promise<PreflightResult> {
    const response = await this.request('/v1/publications/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteId: this.connection.siteId,
        bundle,
        publicationHash,
        ...confirmation,
      }),
    })
    return responseJson(response)
  }

  async publish(
    built: BuiltPublication,
    preflight: PreflightResult,
  ): Promise<PublicationResult> {
    if (!preflight.preflightToken) throw new Error('Preflight did not authorize publishing')
    const form = new FormData()
    form.append('bundle', JSON.stringify(built.bundle))
    form.append('publicationHash', built.publicationHash)
    form.append('preflightToken', preflight.preflightToken)
    for (const index of preflight.requiredUploads) {
      const asset = built.files.get(index)
      if (!asset) throw new Error(`Preflight requested unknown image ${index}`)
      form.append(`image:${index}`, asset.blob, asset.storageName)
    }
    const key = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        JSON.stringify([
          this.connection.siteId,
          built.bundle.document.id,
          built.publicationHash,
        ]),
      ),
    )
    const idempotencyKey = [...new Uint8Array(key)]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')
    return responseJson(
      await this.request('/v1/publications', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: form,
      }),
    )
  }
}
