import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createThread,
  deleteThreadCascade,
  loadThreadsForDoc,
  putComment,
  putThreads,
} from '../db/threads'
import { buildSelector } from '../markdown/anchors'
import { createId } from '../lib/id'
import type { CommentRecord, ThreadWithComments } from '../types'

/**
 * How long a thread may sit without an anchor before it counts as orphaned.
 *
 * A cut leaves the text gone for a few hundred milliseconds before the paste
 * lands, and an accidental delete is usually followed straight away by Cmd-Z.
 * Debouncing means neither flickers through the orphaned state.
 */
const ORPHAN_GRACE_MS = 600

const DEFAULT_AUTHOR = 'You'

export interface ThreadsApi {
  threads: ThreadWithComments[]
  activeId: string | null
  setActiveId: (id: string | null) => void
  getKnownIds: () => ReadonlySet<string>
  onAnchorsChanged: (ids: Set<string>) => void
  addThread: (editor: Editor, body: string) => Promise<string | null>
  reply: (threadId: string, body: string) => Promise<void>
  editComment: (commentId: string, body: string) => Promise<void>
  resolve: (editor: Editor, threadId: string, resolved: boolean) => Promise<void>
  /** Resolve every open thread at once. Returns how many were changed. */
  resolveAll: (editor: Editor) => Promise<number>
  remove: (editor: Editor, threadId: string) => Promise<void>
  reanchor: (editor: Editor, threadId: string) => Promise<void>
}

export function useThreads(docId: string | null): ThreadsApi {
  const [threads, setThreads] = useState<ThreadWithComments[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  // The reconciler runs from a ProseMirror view plugin, outside React's render
  // cycle, so it reads current threads through a ref rather than a stale closure.
  const threadsRef = useRef<ThreadWithComments[]>([])
  threadsRef.current = threads

  const loadedRef = useRef(false)
  const orphanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadedRef.current = false
    setActiveId(null)

    if (!docId) {
      setThreads([])
      return
    }

    let cancelled = false
    void loadThreadsForDoc(docId).then(loaded => {
      if (cancelled) return
      setThreads(loaded)
      loadedRef.current = true
    })

    return () => {
      cancelled = true
    }
  }, [docId])

  useEffect(
    () => () => {
      if (orphanTimer.current) clearTimeout(orphanTimer.current)
    },
    [],
  )

  /**
   * Ids whose anchor is already in the document but whose thread record has not
   * reached React state yet.
   *
   * CommentSanitizer strips any anchor it does not recognise, and it runs in
   * appendTransaction — synchronously, on the very transaction that creates the
   * anchor. Reading known ids from rendered state would therefore judge every
   * brand-new anchor foreign and delete it on the spot.
   */
  const pendingIds = useRef(new Set<string>())

  // Must read live rather than close over a render's value: the sanitizer calls
  // this during a dispatch that can happen before React has re-rendered.
  const getKnownIds = useCallback(
    (): ReadonlySet<string> =>
      new Set([
        ...threadsRef.current.map(thread => thread.id),
        ...pendingIds.current,
      ]),
    [],
  )

  // Once a thread is in state it no longer needs its pending entry, and keeping
  // it would shield a deleted thread's anchor from the sanitizer forever.
  useEffect(() => {
    for (const thread of threads) pendingIds.current.delete(thread.id)
  }, [threads])

  /**
   * Reconcile thread status against the anchors actually present.
   *
   * Orphaning is a status change, never a delete — so an accidental deletion
   * followed by undo restores the thread completely, because the mark comes
   * back and the reviving branch below fires.
   */
  const onAnchorsChanged = useCallback((anchored: Set<string>) => {
    // Checked on arrival, not inside the timer.
    //
    // The editor mounts with empty content, so its very first report is always
    // an empty anchor set. Deferring this check to the timer meant that by the
    // time it ran the threads had loaded, and that meaningless early report
    // orphaned every thread in the document. Nothing is lost by dropping it:
    // loading a document calls setContent, which emits a fresh report.
    if (!loadedRef.current) return

    if (orphanTimer.current) clearTimeout(orphanTimer.current)

    orphanTimer.current = setTimeout(() => {
      if (!loadedRef.current) return

      const changed: ThreadWithComments[] = []
      const now = Date.now()

      for (const thread of threadsRef.current) {
        const isAnchored = anchored.has(thread.id)

        if (!isAnchored && thread.status === 'open') {
          changed.push({
            ...thread,
            status: 'orphaned',
            orphanedAt: now,
            updatedAt: now,
          })
        } else if (isAnchored && thread.status === 'orphaned') {
          changed.push({
            ...thread,
            status: 'open',
            orphanedAt: null,
            updatedAt: now,
          })
        }
      }

      if (!changed.length) return

      const byId = new Map(changed.map(thread => [thread.id, thread]))
      setThreads(previous =>
        previous.map(thread => byId.get(thread.id) ?? thread),
      )
      void putThreads(
        changed.map(({ comments: _comments, ...record }) => record),
      )
    }, ORPHAN_GRACE_MS)
  }, [])

  const addThread = useCallback(
    async (editor: Editor, body: string): Promise<string | null> => {
      if (!docId) return null
      const { from, to } = editor.state.selection
      if (from === to) return null

      const now = Date.now()
      const threadId = createId()
      // Capture the quote BEFORE applying the mark, while the selection is
      // still exactly what the user highlighted.
      const selector = buildSelector(editor.state.doc, from, to)

      const thread = {
        id: threadId,
        docId,
        status: 'open' as const,
        selector,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        orphanedAt: null,
      }
      const first: CommentRecord = {
        id: createId(),
        threadId,
        docId,
        body,
        author: DEFAULT_AUTHOR,
        createdAt: now,
        updatedAt: now,
      }

      // Register before marking: the sanitizer inspects the anchor inside this
      // very command's transaction.
      pendingIds.current.add(threadId)
      editor.commands.setComment(threadId)
      await createThread(thread, first)

      setThreads(previous => [...previous, { ...thread, comments: [first] }])
      setActiveId(threadId)
      return threadId
    },
    [docId],
  )

  const reply = useCallback(
    async (threadId: string, body: string) => {
      if (!docId) return
      const now = Date.now()
      const comment: CommentRecord = {
        id: createId(),
        threadId,
        docId,
        body,
        author: DEFAULT_AUTHOR,
        createdAt: now,
        updatedAt: now,
      }

      await putComment(comment)
      setThreads(previous =>
        previous.map(thread =>
          thread.id === threadId
            ? { ...thread, comments: [...thread.comments, comment] }
            : thread,
        ),
      )
    },
    [docId],
  )

  /**
   * Rewrite the body of a comment already posted.
   *
   * `updatedAt` moving past `createdAt` is what the card reads to show
   * "edited", so it is the record of the change rather than bookkeeping.
   */
  const editComment = useCallback(async (commentId: string, body: string) => {
    const trimmed = body.trim()
    if (!trimmed) return

    let updated: CommentRecord | undefined
    setThreads(previous =>
      previous.map(thread => {
        if (!thread.comments.some(comment => comment.id === commentId)) {
          return thread
        }
        return {
          ...thread,
          comments: thread.comments.map(comment => {
            if (comment.id !== commentId) return comment
            updated = { ...comment, body: trimmed, updatedAt: Date.now() }
            return updated
          }),
        }
      }),
    )

    if (updated) await putComment(updated)
  }, [])

  const resolve = useCallback(
    async (editor: Editor, threadId: string, resolved: boolean) => {
      const now = Date.now()
      editor.commands.setCommentResolved(threadId, resolved)

      let updated: ThreadWithComments | undefined
      setThreads(previous =>
        previous.map(thread => {
          if (thread.id !== threadId) return thread
          updated = {
            ...thread,
            status: resolved ? 'resolved' : 'open',
            resolvedAt: resolved ? now : null,
            updatedAt: now,
          }
          return updated
        }),
      )

      if (updated) {
        const { comments: _comments, ...record } = updated
        await putThreads([record])
      }
    },
    [],
  )

  /**
   * Resolve every open thread in one go.
   *
   * The mark updates go through the same command as a single resolve, which
   * already keeps itself out of undo — resolving is metadata, not an edit. The
   * records are written as one batch rather than one transaction each.
   */
  const resolveAll = useCallback(async (editor: Editor): Promise<number> => {
    const open = threadsRef.current.filter(thread => thread.status === 'open')
    if (!open.length) return 0

    const now = Date.now()
    for (const thread of open) {
      editor.commands.setCommentResolved(thread.id, true)
    }

    const ids = new Set(open.map(thread => thread.id))
    const changed = open.map(({ comments: _comments, ...record }) => ({
      ...record,
      status: 'resolved' as const,
      resolvedAt: now,
      updatedAt: now,
    }))

    setThreads(previous =>
      previous.map(thread =>
        ids.has(thread.id)
          ? {
              ...thread,
              status: 'resolved' as const,
              resolvedAt: now,
              updatedAt: now,
            }
          : thread,
      ),
    )

    await putThreads(changed)
    return changed.length
  }, [])

  const remove = useCallback(async (editor: Editor, threadId: string) => {
    // Delete the record first: the reconciler iterates known threads, so a
    // thread that is already gone cannot orphan itself on the way out.
    await deleteThreadCascade(threadId)
    pendingIds.current.delete(threadId)
    setThreads(previous => previous.filter(thread => thread.id !== threadId))
    setActiveId(current => (current === threadId ? null : current))
    editor.commands.unsetComment(threadId)
  }, [])

  /** Re-attach an orphaned thread to the current selection. */
  const reanchor = useCallback(async (editor: Editor, threadId: string) => {
    const { from, to } = editor.state.selection
    if (from === to) return

    const now = Date.now()
    const selector = buildSelector(editor.state.doc, from, to)
    editor.commands.setComment(threadId)

    let updated: ThreadWithComments | undefined
    setThreads(previous =>
      previous.map(thread => {
        if (thread.id !== threadId) return thread
        updated = {
          ...thread,
          status: 'open',
          orphanedAt: null,
          selector,
          updatedAt: now,
        }
        return updated
      }),
    )
    setActiveId(threadId)

    if (updated) {
      const { comments: _comments, ...record } = updated
      await putThreads([record])
    }
  }, [])

  return {
    threads,
    activeId,
    setActiveId,
    getKnownIds,
    onAnchorsChanged,
    addThread,
    reply,
    editComment,
    resolve,
    resolveAll,
    remove,
    reanchor,
  }
}
