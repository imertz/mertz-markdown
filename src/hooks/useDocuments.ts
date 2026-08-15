import type { JSONContent } from '@tiptap/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { putDocumentWithAssets } from '../db/assets'
import {
  deleteDocumentCascade,
  getDocument,
  listDocuments,
  listTrashedDocuments,
  purgeExpiredTrash,
  putDocument,
  renameProject,
  renameTag,
  restoreDocument,
  setDocumentProject,
  setDocumentTags,
  softDeleteDocument,
} from '../db/documents'
import {
  addSnapshot,
  latestSnapshotAt,
  pruneSnapshots,
} from '../db/snapshots'
import { createId } from '../lib/id'
import { dropDocument, invalidateIndex, reindexDocument } from '../search/store'
import {
  SNAPSHOT_LIMIT,
  shouldSnapshot,
} from '../lib/snapshotPolicy'
import { deriveTitle, UNTITLED } from '../lib/title'
import { isBundleFile, readDocumentBundle } from '../markdown/bundle'
import { titleFromFilename } from '../markdown/import'
import { createMarkdownManager } from '../markdown/manager'
import type { DocumentRecord, SnapshotCause } from '../types'

const LAST_OPENED_KEY = 'mertz-markdown:last-opened'

export type SaveStatus = 'loading' | 'saved' | 'saving' | 'error'

export interface DocumentsApi {
  documents: DocumentRecord[]
  /** Soft-deleted documents, most recently deleted first. */
  trashed: DocumentRecord[]
  activeId: string | null
  /**
   * Content for the editor to mount with. Deliberately NOT refreshed on save —
   * it is a `useEditor` dependency, so updating it on every autosave would tear
   * the editor down mid-keystroke.
   */
  initialDoc: JSONContent | null
  status: SaveStatus
  activeTitle: string
  /** Changes only when storage was replaced by a remote sync. */
  contentRevision: number
  refreshFromStorage: () => Promise<void>
  select: (id: string) => void
  /**
   * Start a new document, optionally filed under a project — so "New document"
   * pressed while the picker is narrowed to one lands where the user is looking.
   */
  create: (project?: string | null) => Promise<void>
  /** Moves to the trash and returns the record, so a caller can offer an undo. */
  remove: (id: string) => Promise<DocumentRecord | null>
  restore: (id: string) => Promise<void>
  /** Permanent, cascading delete. There is no undo past this. */
  destroy: (id: string) => Promise<void>
  /**
   * Give a document a name of its own. An empty name clears it, which is the
   * only route back to a title derived from the content.
   */
  rename: (id: string, name: string) => Promise<void>
  /** File one document under a project, or unfile it with `null`. */
  setProject: (id: string, project: string | null) => Promise<void>
  /** Replace one document's tags; the list is normalised on the way in. */
  setTags: (id: string, tags: readonly string[]) => Promise<void>
  /** Rename a project everywhere it is used. `null` unfiles every document in it. */
  renameProject: (from: string, to: string | null) => Promise<void>
  /** Rename a tag everywhere it is used. `null` removes it. */
  renameTag: (from: string, to: string | null) => Promise<void>
  save: (docId: string, doc: JSONContent, markdown: string) => Promise<void>
  snapshot: (
    docId: string,
    doc: JSONContent,
    markdown: string,
    cause: SnapshotCause,
  ) => Promise<void>
  importFile: (file: File) => Promise<void>
}

const emptyDoc = (): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph' }],
})

function newDocument(project: string | null = null): DocumentRecord {
  const now = Date.now()
  return {
    id: createId(),
    title: UNTITLED,
    doc: emptyDoc(),
    markdown: '',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    project,
  }
}

export function useDocuments(): DocumentsApi {
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [trashed, setTrashed] = useState<DocumentRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [initialDoc, setInitialDoc] = useState<JSONContent | null>(null)
  const [status, setStatus] = useState<SaveStatus>('loading')
  const [contentRevision, setContentRevision] = useState(0)

  // StrictMode double-invokes effects. Without this the first run would create
  // two starter documents.
  const bootstrapped = useRef(false)

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true

    const bootstrap = async () => {
      try {
        // Before listing, so an expired document never appears for the instant
        // it takes the purge to finish.
        await purgeExpiredTrash()

        let all = await listDocuments()

        if (all.length === 0) {
          const starter = newDocument()
          await putDocument(starter)
          all = [starter]
        }

        const remembered = localStorage.getItem(LAST_OPENED_KEY)
        const opening =
          all.find(candidate => candidate.id === remembered) ?? all[0]

        setDocuments(all)
        setTrashed(await listTrashedDocuments())
        if (opening) {
          setActiveId(opening.id)
          setInitialDoc(opening.doc)
        }
        setStatus('saved')
      } catch (error) {
        console.error('[documents] bootstrap failed', error)
        setStatus('error')
      }
    }

    void bootstrap()
  }, [])

  useEffect(() => {
    if (activeId) localStorage.setItem(LAST_OPENED_KEY, activeId)
  }, [activeId])

  const select = useCallback(
    (id: string) => {
      if (id === activeId) return
      const target = documents.find(candidate => candidate.id === id)
      if (!target) return
      setActiveId(id)
      setInitialDoc(target.doc)
    },
    [activeId, documents],
  )

  /*
   * Keeping the search index level with the database.
   *
   * Every one of these is fire-and-forget, on the same reasoning as the
   * `void snapshot(...)` below: the write has landed, and no user-visible
   * status should wait on bookkeeping. Nor can they corrupt anything if they
   * lose a race — the index is derived from IndexedDB and every mutation writes
   * there first, so a rebuild is always the truth. See src/search/store.ts.
   */
  const reindex = useCallback((record: DocumentRecord) => {
    void reindexDocument(record).catch(error => {
      console.error('[search] reindex failed', error)
    })
  }, [])

  const create = useCallback(async (project: string | null = null) => {
    const record = newDocument(project)
    await putDocument(record)
    reindex(record)
    setDocuments(previous => [record, ...previous])
    setActiveId(record.id)
    setInitialDoc(record.doc)
    setStatus('saved')
  }, [reindex])

  /** Open whichever document should take over from one leaving the list. */
  const openFrom = useCallback(async (remaining: DocumentRecord[]) => {
    if (remaining.length === 0) {
      const replacement = newDocument()
      await putDocument(replacement)
      reindex(replacement)
      setDocuments([replacement])
      setActiveId(replacement.id)
      setInitialDoc(replacement.doc)
      return
    }

    setDocuments(remaining)
    const next = remaining[0]
    setActiveId(next.id)
    setInitialDoc(next.doc)
  }, [reindex])

  const remove = useCallback(
    async (id: string): Promise<DocumentRecord | null> => {
      const record = await softDeleteDocument(id)
      if (!record) return null
      // Not a drop: trashed documents stay searchable behind the Trash chip.
      reindex(record)

      const remaining = documents.filter(candidate => candidate.id !== id)
      setTrashed(previous => [record, ...previous])

      if (remaining.length === 0 || id === activeId) {
        await openFrom(remaining)
      } else {
        setDocuments(remaining)
      }

      return record
    },
    [activeId, documents, openFrom, reindex],
  )

  const restore = useCallback(async (id: string) => {
    const record = await restoreDocument(id)
    if (!record) return
    reindex(record)

    setTrashed(previous => previous.filter(candidate => candidate.id !== id))
    setDocuments(previous =>
      // Back into its place by updatedAt, not on top: restoring is not editing.
      [...previous.filter(candidate => candidate.id !== id), record].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    )
    setActiveId(record.id)
    setInitialDoc(record.doc)
  }, [reindex])

  const destroy = useCallback(async (id: string) => {
    await deleteDocumentCascade(id)
    void dropDocument(id).catch(error => {
      console.error('[search] drop failed', error)
    })
    setTrashed(previous => previous.filter(candidate => candidate.id !== id))
  }, [])

  const rename = useCallback(async (id: string, name: string) => {
    const existing = await getDocument(id)
    if (!existing) return

    const trimmed = name.trim()
    const titleOverride = trimmed === '' ? null : trimmed

    const record: DocumentRecord = {
      ...existing,
      titleOverride,
      // Clearing the name has to recompute here and not wait for the next
      // autosave, or the document would keep wearing the name just dropped.
      title: titleOverride ?? deriveTitle(existing.doc),
      // `updatedAt` is deliberately untouched: the list is ordered by it, and
      // renaming from inside that list would otherwise make the row jump out
      // from under the pointer that just renamed it.
    }

    await putDocument(record)
    reindex(record)
    setDocuments(previous =>
      previous.map(candidate => (candidate.id === id ? record : candidate)),
    )
  }, [reindex])

  /*
   * Filing.
   *
   * None of these move `updatedAt` — the database writers are what enforce
   * that; see the block comment above them in `src/db/documents.ts`. The local
   * state is patched in place rather than re-listed, exactly as `rename` does,
   * so the list keeps the order the user is looking at.
   */

  /** Replace one document in both the live list and the trash, wherever it is. */
  const patch = useCallback((record: DocumentRecord) => {
    reindex(record)
    const swap = (previous: DocumentRecord[]) =>
      previous.map(candidate => (candidate.id === record.id ? record : candidate))
    setDocuments(swap)
    setTrashed(swap)
  }, [reindex])

  const setProject = useCallback(
    async (id: string, project: string | null) => {
      const record = await setDocumentProject(id, project)
      if (record) patch(record)
    },
    [patch],
  )

  const setTags = useCallback(
    async (id: string, tags: readonly string[]) => {
      const record = await setDocumentTags(id, tags)
      if (record) patch(record)
    },
    [patch],
  )

  /**
   * Bulk edits touch documents this hook may not be holding — trashed ones, and
   * on a later render any that arrived by sync — so both lists are re-read
   * rather than patched. The order is unchanged either way, because the writers
   * leave `updatedAt` alone.
   */
  const relist = useCallback(async () => {
    invalidateIndex()
    setDocuments(await listDocuments())
    setTrashed(await listTrashedDocuments())
  }, [])

  const renameProjectEverywhere = useCallback(
    async (from: string, to: string | null) => {
      if (await renameProject(from, to)) await relist()
    },
    [relist],
  )

  const renameTagEverywhere = useCallback(
    async (from: string, to: string | null) => {
      if (await renameTag(from, to)) await relist()
    },
    [relist],
  )

  /**
   * Write a restore point.
   *
   * `interval` snapshots are rate-limited by the policy; anything the user
   * asked for explicitly is written whatever the clock says.
   */
  const snapshot = useCallback(
    async (
      docId: string,
      doc: JSONContent,
      markdown: string,
      cause: SnapshotCause,
    ) => {
      try {
        if (cause === 'interval') {
          const lastAt = await latestSnapshotAt(docId)
          if (!shouldSnapshot(lastAt, Date.now())) return
        }

        await addSnapshot({
          id: createId(),
          docId,
          doc,
          markdown,
          title: deriveTitle(doc),
          createdAt: Date.now(),
          cause,
        })
        await pruneSnapshots(docId, SNAPSHOT_LIMIT)
      } catch (error) {
        // A snapshot is a courtesy. Failing to take one must never be reported
        // as the document failing to save, because it did.
        console.error('[snapshots] write failed', error)
      }
    },
    [],
  )

  const save = useCallback(
    async (docId: string, doc: JSONContent, markdown: string) => {
      setStatus('saving')
      try {
        // Re-read rather than trusting list state: the record may have been
        // touched by another code path (a title edit, a thread write) since
        // this save was queued. It also carries the tombstone, so an autosave
        // that lands after a delete cannot quietly revive the document.
        const existing = (await getDocument(docId)) ?? newDocument()
        const record: DocumentRecord = {
          ...existing,
          id: docId,
          doc,
          markdown,
          // A name the user typed outranks the content it was typed over.
          title: existing.titleOverride ?? deriveTitle(doc),
          updatedAt: Date.now(),
        }

        await putDocument(record)

        setDocuments(previous => {
          const without = previous.filter(candidate => candidate.id !== docId)
          return [record, ...without]
        })
        setStatus('saved')

        // Deliberately not awaited: the save is done, and the status must not
        // wait on history bookkeeping to say so.
        void snapshot(docId, doc, markdown, 'interval')
        reindex(record)
      } catch (error) {
        console.error('[documents] save failed', error)
        setStatus('error')
        throw error
      }
    },
    [reindex, snapshot],
  )

  /**
   * Open a Markdown file or a portable Markdown + images bundle.
   *
   * Parsed with the standalone MarkdownManager rather than through the live
   * editor, so importing never disturbs whatever is currently open.
   */
  const importFile = useCallback(
    async (file: File) => {
      const manager = createMarkdownManager()
      const now = Date.now()
      const id = createId()

      if (isBundleFile(file)) {
        const imported = await readDocumentBundle(file, id)
        const record: DocumentRecord = {
          id,
          title: imported.title,
          doc: imported.doc,
          markdown: imported.markdown,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        }

        await putDocumentWithAssets(record, imported.assets)
        reindex(record)
        setDocuments(previous => [record, ...previous])
        setActiveId(record.id)
        setInitialDoc(record.doc)
        setStatus('saved')
        return
      }

      const markdown = await file.text()
      const parsed = manager.parse(markdown)

      const record: DocumentRecord = {
        id,
        title: titleFromFilename(file.name),
        doc: parsed,
        markdown,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }

      await putDocument(record)
      reindex(record)
      setDocuments(previous => [record, ...previous])
      setActiveId(record.id)
      setInitialDoc(record.doc)
      setStatus('saved')
    },
    [reindex],
  )

  const activeTitle =
    documents.find(candidate => candidate.id === activeId)?.title ?? UNTITLED

  const refreshFromStorage = useCallback(async () => {
    const live = await listDocuments()
    const deleted = await listTrashedDocuments()
    let opening = activeId ? live.find(record => record.id === activeId) : undefined
    opening ??= live[0]
    if (!opening && live.length === 0) {
      const replacement = newDocument()
      await putDocument(replacement)
      opening = replacement
      live.push(replacement)
    }
    // Vault sync and conflict restore replace records below useDocuments, so
    // their one refresh choke point must invalidate the derived search index.
    invalidateIndex()
    setDocuments(live)
    setTrashed(deleted)
    setActiveId(opening?.id ?? null)
    setInitialDoc(opening?.doc ?? null)
    setContentRevision(value => value + 1)
    setStatus('saved')
  }, [activeId])

  return {
    documents,
    trashed,
    activeId,
    initialDoc,
    status,
    activeTitle,
    contentRevision,
    refreshFromStorage,
    select,
    create,
    remove,
    restore,
    destroy,
    rename,
    setProject,
    setTags,
    renameProject: renameProjectEverywhere,
    renameTag: renameTagEverywhere,
    save,
    snapshot,
    importFile,
  }
}
