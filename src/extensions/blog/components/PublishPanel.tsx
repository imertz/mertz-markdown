import { useCallback, useEffect, useMemo, useState } from 'react'
import { getDocument } from '../../../db/documents'
import { toMarkdown } from '../../../markdown/export'
import {
  getExtensionDocumentState,
  putExtensionDocumentState,
} from '../../storage'
import type { DocumentPanelProps } from '../../types'
import {
  BlogApiClient,
  type PreflightResult,
  type PublisherCapabilities,
} from '../api'
import { buildPublicationBundle, type BuiltPublication } from '../bundle'
import {
  BLOG_EXTENSION_ID,
  BLOG_STATE_VERSION,
  defaultArticleState,
  type BlogArticleState,
  type BlogExtensionSettings,
} from '../state'
import { ArticleSettings } from './ArticleSettings'

export function PublishPanel({
  documentId,
  editor,
  settings,
  flushPendingWrites,
  close,
  notify,
}: DocumentPanelProps<BlogExtensionSettings>) {
  const connection = settings.data.connection
  const [article, setArticle] = useState<BlogArticleState>(() =>
    defaultArticleState(documentId, connection?.siteId),
  )
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    images: number
    hash: string
  } | null>(null)
  const [capabilities, setCapabilities] =
    useState<PublisherCapabilities | null>(null)

  const persist = useCallback(
    async (next: BlogArticleState) => {
      await putExtensionDocumentState({
        extensionId: BLOG_EXTENSION_ID,
        documentId,
        version: BLOG_STATE_VERSION,
        data: next,
        updatedAt: Date.now(),
      })
      setArticle(next)
      setTags(next.tags.join(', '))
    },
    [documentId],
  )

  useEffect(() => {
    let current = true
    void (async () => {
      const stored = await getExtensionDocumentState<BlogArticleState>(
        BLOG_EXTENSION_ID,
        documentId,
      )
      let next =
        stored?.data ?? defaultArticleState(documentId, connection?.siteId)
      if (connection) {
        const supported = await new BlogApiClient(connection).capabilities()
        if (current) setCapabilities(supported)
      }
      if (connection && (!next.remotePostId || !stored)) {
        const remote = await new BlogApiClient(connection).publication(documentId)
        if (remote) {
          next = stored
            ? {
                ...next,
                siteId: remote.siteId,
                remotePostId: remote.remotePostId,
                remoteUrl: remote.remoteUrl,
                remoteSlug: remote.remoteSlug,
                lastPublishedRevision: remote.lastPublishedRevision,
                lastPublishedHash: remote.lastPublishedHash,
                publishedAt: remote.publishedAt,
              }
            : remote
          await persist(next)
        }
      }
      if (!current) return
      setArticle(next)
      setTags(next.tags.join(', '))
      setLoading(false)
    })().catch(caught => {
      if (!current) return
      setError(caught instanceof Error ? caught.message : 'Publication state could not load')
      setLoading(false)
    })
    return () => {
      current = false
    }
  }, [connection, documentId, persist])

  const desired = useMemo(
    () => ({
      ...article,
      tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
    }),
    [article, tags],
  )

  useEffect(() => {
    if (loading) return
    let current = true
    const timer = window.setTimeout(() => {
      void getDocument(documentId)
        .then(record => {
          if (!record || !current) return null
          return buildPublicationBundle(
            {
              ...record,
              doc: editor.getJSON(),
              markdown: toMarkdown(editor),
            },
            desired,
          )
        })
        .then(built => {
          if (built && current) {
            setPreview({
              images: built.bundle.images.length,
              hash: built.publicationHash,
            })
            setError(null)
          }
        })
        .catch(caught => {
          if (current) {
            setPreview(null)
            setError(caught instanceof Error ? caught.message : 'Publication could not be prepared')
          }
        })
    }, 120)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [desired, documentId, editor, loading])

  const confirmAttention = async (
    api: BlogApiClient,
    built: BuiltPublication,
    first: PreflightResult,
  ): Promise<PreflightResult> => {
    const attention = first.attention
    if (!attention) return first
    if (attention.code === 'slug_taken') throw new Error(attention.message)
    const confirmed = window.confirm(`${attention.message}\n\nContinue?`)
    if (!confirmed) throw new Error('Publishing was cancelled')
    return api.preflight(built.bundle, built.publicationHash, {
      allowSlugChange: attention.code === 'slug_would_change',
    })
  }

  const publish = async (forceDraft = false) => {
    if (!connection) return
    setBusy(true)
    setError(null)
    try {
      await flushPendingWrites()
      const record = await getDocument(documentId)
      if (!record) throw new Error('The document is no longer available')
      const publishing = forceDraft ? { ...desired, draft: true } : desired
      await persist(publishing)
      const built = await buildPublicationBundle(record, publishing)
      const api = new BlogApiClient(connection)
      let preflight = await api.preflight(
        built.bundle,
        built.publicationHash,
      )
      if (preflight.status === 'attention') {
        preflight = await confirmAttention(api, built, preflight)
      }
      if (preflight.status === 'unchanged') {
        if (preflight.publication) await persist(preflight.publication)
        notify('Publication is already current')
        return
      }
      const result = await api.publish(built, preflight)
      await persist(result.publication)
      notify(forceDraft ? 'Publication returned to draft' : 'Published')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Publishing failed')
    } finally {
      setBusy(false)
    }
  }

  const modified =
    preview !== null && article.lastPublishedHash !== null
      ? preview.hash !== article.lastPublishedHash
      : null

  return (
    <div className="extension-panel-backdrop" role="presentation">
      <section
        className="publication-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publication-panel-title"
      >
        <header className="publication-panel__header">
          <div>
            <p className="publication-panel__eyebrow">Blog Publisher</p>
            <h2 id="publication-panel-title">Publish to Solon Blog</h2>
          </div>
          <button type="button" aria-label="Close publishing" onClick={close}>
            Close
          </button>
        </header>

        {loading ? <p>Loading publication…</p> : null}
        {!loading && !connection ? (
          <p>Connect a publishing server in Extensions settings first.</p>
        ) : null}
        {!loading && connection ? (
          <>
            <div className="publication-panel__status">
              <strong>
                {article.remotePostId
                  ? article.draft
                    ? 'Draft'
                    : 'Published'
                  : 'Not published'}
              </strong>
              {modified === true ? <span>Modified since publication</span> : null}
              {article.remoteUrl ? (
                <a href={article.remoteUrl} target="_blank" rel="noreferrer">
                  {article.remoteUrl}
                </a>
              ) : null}
            </div>

            <label className="publication-panel__toggle">
              <input
                type="checkbox"
                checked={article.enabled}
                onChange={event =>
                  void persist({ ...desired, enabled: event.target.checked })
                }
              />
              Enable publishing for this document
            </label>
            <ArticleSettings
              tags={tags}
              draft={article.draft}
              capabilities={capabilities}
              onTagsChanged={setTags}
              onTagsCommitted={() => void persist(desired)}
              onDraftChanged={draft => void persist({ ...desired, draft })}
            />

            <div className="publication-panel__images">
              <span>Images</span>
              <strong>
                {preview ? `${preview.images} ready` : 'Not ready'}
              </strong>
            </div>
            {preview && preview.images > 0 && capabilities ? (
              <p className="publication-panel__capabilities">
                {capabilities.captions
                  ? 'Captions are supported.'
                  : 'Captions will not be applied by this publisher.'}{' '}
                {capabilities.imageDimensions
                  ? 'Display dimensions are supported.'
                  : 'Display dimensions remain recorded but are not applied.'}
              </p>
            ) : null}
            {error ? <p className="publication-panel__error">{error}</p> : null}

            <footer className="publication-panel__actions">
              {article.remotePostId && !article.draft ? (
                <button
                  type="button"
                  disabled={busy || !article.enabled || !preview}
                  onClick={() => void publish(true)}
                >
                  Return to draft
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy || !article.enabled || !preview}
                onClick={() => void publish()}
              >
                {busy
                  ? 'Publishing…'
                  : article.remotePostId
                    ? 'Update publication'
                    : 'Publish'}
              </button>
            </footer>
          </>
        ) : null}
      </section>
    </div>
  )
}
