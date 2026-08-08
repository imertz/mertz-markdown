import type { PublisherCapabilities } from '../api'

interface ArticleSettingsProps {
  tags: string
  draft: boolean
  capabilities: PublisherCapabilities | null
  onTagsChanged: (value: string) => void
  onTagsCommitted: () => void
  onDraftChanged: (value: boolean) => void
}

export function ArticleSettings({
  tags,
  draft,
  capabilities,
  onTagsChanged,
  onTagsCommitted,
  onDraftChanged,
}: ArticleSettingsProps) {
  return (
    <>
      <label>
        <span>Tags</span>
        <input
          type="text"
          value={tags}
          placeholder="typescript, architecture"
          disabled={capabilities?.tags === false}
          onChange={event => onTagsChanged(event.target.value)}
          onBlur={onTagsCommitted}
        />
        {capabilities?.tags === false ? <small>Not supported by this publisher</small> : null}
      </label>
      <label className="publication-panel__toggle">
        <input
          type="checkbox"
          checked={draft}
          disabled={capabilities?.drafts === false}
          onChange={event => onDraftChanged(event.target.checked)}
        />
        Draft
      </label>
    </>
  )
}
