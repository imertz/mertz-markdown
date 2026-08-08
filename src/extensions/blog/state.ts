export const BLOG_EXTENSION_ID = 'blog'
export const BLOG_STATE_VERSION = 1

export interface BlogConnection {
  serverUrl: string
  deviceId: string
  deviceToken: string
  siteId: string
  siteName: string
  connectedAt: number
}

export interface BlogExtensionSettings {
  connection: BlogConnection | null
}

export interface BlogArticleState {
  documentId: string
  siteId: string
  enabled: boolean
  draft: boolean
  tags: string[]
  remotePostId: string | null
  remoteUrl: string | null
  remoteSlug: string | null
  lastPublishedRevision: string | null
  lastPublishedHash: string | null
  publishedAt: number | null
}

export const DEFAULT_BLOG_SETTINGS: BlogExtensionSettings = {
  connection: null,
}

export function defaultArticleState(
  documentId: string,
  siteId = '',
): BlogArticleState {
  return {
    documentId,
    siteId,
    enabled: false,
    draft: true,
    tags: [],
    remotePostId: null,
    remoteUrl: null,
    remoteSlug: null,
    lastPublishedRevision: null,
    lastPublishedHash: null,
    publishedAt: null,
  }
}
