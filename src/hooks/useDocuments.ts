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
  restoreDocument,
  softDeleteDocument,
} from '../db/documents'
import {
  addSnapshot,
  latestSnapshotAt,
  pruneSnapshots,
} from '../db/snapshots'
import { createId } from '../lib/id'
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
  create: () => Promise<void>
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

function newDocument(): DocumentRecord {
  const now = Date.now()
  return {
    id: createId(),
    title: UNTITLED,
    doc: emptyDoc(),
    markdown: '',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
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

  const create = useCallback(async () => {
    const record = newDocument()
    await putDocument(record)
    setDocuments(previous => [record, ...previous])
    setActiveId(record.id)
    setInitialDoc(record.doc)
    setStatus('saved')
  }, [])

  /** Open whichever document should take over from one leaving the list. */
  const openFrom = useCallback(async (remaining: DocumentRecord[]) => {
    if (remaining.length === 0) {
      const replacement = newDocument()
      await putDocument(replacement)
      setDocuments([replacement])
      setActiveId(replacement.id)
      setInitialDoc(replacement.doc)
      return
    }

    setDocuments(remaining)
    const next = remaining[0]
    setActiveId(next.id)
    setInitialDoc(next.doc)
  }, [])

  const remove = useCallback(
    async (id: string): Promise<DocumentRecord | null> => {
      const record = await softDeleteDocument(id)
      if (!record) return null

      const remaining = documents.filter(candidate => candidate.id !== id)
      setTrashed(previous => [record, ...previous])

      if (remaining.length === 0 || id === activeId) {
        await openFrom(remaining)
      } else {
        setDocuments(remaining)
      }

      return record
    },
    [activeId, documents, openFrom],
  )

  const restore = useCallback(async (id: string) => {
    const record = await restoreDocument(id)
    if (!record) return

    setTrashed(previous => previous.filter(candidate => candidate.id !== id))
    setDocuments(previous =>
      // Back into its place by updatedAt, not on top: restoring is not editing.
      [...previous.filter(candidate => candidate.id !== id), record].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    )
    setActiveId(record.id)
    setInitialDoc(record.doc)
  }, [])

  const destroy = useCallback(async (id: string) => {
    await deleteDocumentCascade(id)
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
    setDocuments(previous =>
      previous.map(candidate => (candidate.id === id ? record : candidate)),
    )
  }, [])

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
      } catch (error) {
        console.error('[documents] save failed', error)
        setStatus('error')
      }
    },
    [snapshot],
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
      setDocuments(previous => [record, ...previous])
      setActiveId(record.id)
      setInitialDoc(record.doc)
      setStatus('saved')
    },
    [],
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
    save,
    snapshot,
    importFile,
  }
}
