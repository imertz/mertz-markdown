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
  /**
   * Which project the document is filed under, or `null` for unfiled.
   *
   * The name itself, not a reference: there is no project store, and the list
   * of projects is derived from whatever names the documents carry. A project
   * therefore exists exactly as long as something is filed under it.
   *
   * Optional for the same reason as `titleOverride` — records written before
   * projects existed read back as unfiled rather than as invalid.
   */
  project?: string | null
  /**
   * Free-form labels, normalised and deduplicated by `normalizeTags`.
   *
   * App metadata like the project above: it survives autosave, snapshots and
   * encrypted sync, and never reaches the exported Markdown.
   */
  tags?: string[]
}

/** Device-local configuration owned by one compile-time application extension. */
export interface ExtensionSettingsRecord {
  extensionId: string
  version: number
  enabled: boolean
  data: unknown
  updatedAt: number
}

/** Document-scoped extension data carried inside the encrypted document graph. */
export interface ExtensionDocumentStateRecord {
  extensionId: string
  documentId: string
  version: number
  data: unknown
  updatedAt: number
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

/** Client-only credentials and progress for the optional encrypted vault. */
export interface VaultConfigRecord {
  id: 'primary'
  vaultId: string
  /** Raw 256-bit key. It never leaves this browser except wrapped for pairing. */
  masterKey: ArrayBuffer
  deviceId: string
  deviceToken: string
  deviceLabel: string
  apiUrl: string
  cursor: number
  clockOffsetMs: number
  createdAt: number
}

export type SyncObjectKind = 'document' | 'asset'
export type SyncOperation = 'put' | 'delete'

/** One coalesced local change. A document entry represents its whole sidecar graph. */
export interface SyncOutboxRecord {
  id: string
  kind: SyncObjectKind
  objectId: string
  docId: string
  operation: SyncOperation
  changedAt: number
  attempts: number
  nextAttemptAt: number
}

/** Last remote revision known for an encrypted object. */
export interface SyncObjectStateRecord {
  id: string
  kind: SyncObjectKind
  objectId: string
  revision: number
  changedAt: number
  deleted: boolean
}

/** A complete losing document revision retained for safe conflict restoration. */
export interface SyncConflictRecord {
  id: string
  docId: string
  revision: number
  changedAt: number
  deviceLabel: string
  package: SyncedDocumentPackage
  createdAt: number
}

/** Plaintext only inside AES-GCM; the server stores the resulting ciphertext. */
export interface SyncedDocumentPackageV1 {
  schemaVersion: 1
  document: DocumentRecord
  threads: ThreadRecord[]
  comments: CommentRecord[]
  snapshots: SnapshotRecord[]
  assetIds: string[]
  changedAt: number
  deviceLabel: string
}

export interface SyncedDocumentPackageV2 {
  schemaVersion: 2
  document: DocumentRecord
  threads: ThreadRecord[]
  comments: CommentRecord[]
  snapshots: SnapshotRecord[]
  assetIds: string[]
  extensionDocumentStates: ExtensionDocumentStateRecord[]
  changedAt: number
  deviceLabel: string
}

export type SyncedDocumentPackage =
  | SyncedDocumentPackageV1
  | SyncedDocumentPackageV2
