import type { JSONContent } from '@tiptap/core'

/** Binary image data kept out of the canonical ProseMirror document. */
export interface AssetRecord {
  id: string
  /** Assets are document-owned so trash purge can delete them transactionally. */
  docId: string
  blob: Blob
  mimeType: string
  originalName: string
  /** Stable, collision-free relative filename used by Markdown and ZIP export. */
  storageName: string
  size: number
  createdAt: number
}

/**
 * W3C Web Annotation TextQuoteSelector.
 *
 * This is the *fallback* anchor. During a session, comment positions are
 * carried by ProseMirror marks inside the canonical document, which the editor
 * maps through every transaction for free. The selector only earns its keep
 * when a plain `.md` file is imported — markdown has no way to express "this
 * span carries thread X", so the anchors have to be re-found by content.
 */
export interface TextQuoteSelector {
  /** The exact text the thread was attached to. */
  exact: string
  /** Up to 32 characters immediately before `exact`, for disambiguation. */
  prefix: string
  /** Up to 32 characters immediately after `exact`, for disambiguation. */
  suffix: string
}

export interface DocumentRecord {
  id: string
  /** What the UI shows: `titleOverride` when there is one, else derived. */
  title: string
  /**
   * A name the user typed, which pins `title` against re-derivation on save.
   *
   * Optional rather than required so records written before renaming existed
   * read back as untouched — absent and `null` both mean "follow the content".
   */
  titleOverride?: string | null
  /**
   * CANONICAL. Comment marks live here and nowhere else. Markdown cannot
   * represent them, so this is what makes anchors survive a save/load cycle.
   */
  doc: JSONContent
  /**
   * DERIVED from `doc` on every save. Export payload, search haystack, and
   * recovery fallback. Contains zero trace of comments by construction.
   */
  markdown: string
  createdAt: number
  updatedAt: number
  /** Soft-delete tombstone; `null` means live. */
  deletedAt: number | null
}

export type ThreadStatus = 'open' | 'resolved' | 'orphaned'

export interface ThreadRecord {
  /** Identical to the comment mark's `threadId` attribute. */
  id: string
  docId: string
  status: ThreadStatus
  /** Re-anchor fallback, captured at creation time from the live selection. */
  selector: TextQuoteSelector
  createdAt: number
  updatedAt: number
  resolvedAt: number | null
  orphanedAt: number | null
}

export interface CommentRecord {
  id: string
  threadId: string
  /** Denormalised from the thread so a document's comments load in one index hit. */
  docId: string
  body: string
  author: string
  createdAt: number
  updatedAt: number
}

/** A thread joined with its comments, ordered oldest first. */
export interface ThreadWithComments extends ThreadRecord {
  comments: CommentRecord[]
}

/** Why a snapshot exists — shown in the history list to explain the entry. */
export type SnapshotCause =
  /** Taken automatically by a save, once the interval had elapsed. */
  | 'interval'
  /** Taken of the *current* state immediately before restoring an older one. */
  | 'restore'
  /** Asked for explicitly. */
  | 'manual'

export interface SnapshotRecord {
  id: string
  docId: string
  /**
   * CANONICAL, exactly as `DocumentRecord.doc`. Restoring has to bring comment
   * anchors back with it, and markdown has no way to carry them — so a
   * snapshot that stored only the markdown would silently drop every thread
   * the document had at the time.
   */
  doc: JSONContent
  /** DERIVED, kept so a diff never has to re-serialize an old document. */
  markdown: string
  /** As it was when the snapshot was taken; the live title may have moved on. */
  title: string
  createdAt: number
  cause: SnapshotCause
}
