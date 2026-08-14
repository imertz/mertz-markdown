import type { Editor, JSONContent } from '@tiptap/core'
import { useEditor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import { buildExtensions } from './extensions'
import { COMMENT_SANITIZER_RECHECK } from './extensions/commentSanitizer'

export interface UseMarkdownEditorOptions {
  /** Id of the document currently open. `null` until the store has loaded. */
  activeId: string | null
  /** Canonical ProseMirror JSON for `activeId`. */
  initialDoc: JSONContent | null
  /** Fired on every document change; the caller debounces. */
  onDocChanged?: (editor: Editor) => void
  /** Fired when the set of threads holding a live anchor changes. */
  onAnchorsChanged?: (threadIds: Set<string>) => void
  /** Threads belonging to the open document; anything else is foreign paste. */
  getKnownThreadIds?: () => ReadonlySet<string> | null
  /** Advances when the authoritative thread-id set finishes loading. */
  commentThreadRevision?: number
  resolveImageAsset?: (assetId: string) => Promise<Blob | undefined>
  onImageFiles?: (editor: Editor, files: File[], position?: number) => void
  /**
   * Fired once per document load, immediately after the content lands.
   *
   * `activeId` changes a commit earlier than the content does, so anything that
   * needs to act on the *new* document — jumping to a search hit, say — cannot
   * key off it without reading the outgoing document instead.
   */
  onDocumentLoaded?: (docId: string) => void
}

/**
 * One editor instance for the life of the app.
 *
 * Content is swapped with `setContent` rather than by passing the document as a
 * `useEditor` dependency. Recreating the editor on document load tears down the
 * ProseMirror view, and anything still subscribed to it — the Toolbar's
 * `useEditorState`, the comment sidebar — then reads a destroyed instance whose
 * `view` is gone. Swapping content keeps the instance stable and is cheaper.
 *
 * Every callback is read through a ref for the same reason: a changing closure
 * must never be a reason to rebuild the editor.
 */
export function useMarkdownEditor({
  activeId,
  initialDoc,
  onDocChanged,
  onAnchorsChanged,
  getKnownThreadIds,
  commentThreadRevision = 0,
  resolveImageAsset,
  onImageFiles,
  onDocumentLoaded,
}: UseMarkdownEditorOptions): Editor | null {
  const handlers = useRef({
    onDocChanged,
    onAnchorsChanged,
    getKnownThreadIds,
    resolveImageAsset,
    onImageFiles,
    onDocumentLoaded,
  })
  useEffect(() => {
    handlers.current = {
      onDocChanged,
      onAnchorsChanged,
      getKnownThreadIds,
      resolveImageAsset,
      onImageFiles,
      onDocumentLoaded,
    }
  })

  const editor = useEditor({
    extensions: buildExtensions({
      onAnchorsChanged: ids => handlers.current.onAnchorsChanged?.(ids),
      getKnownThreadIds: () =>
        handlers.current.getKnownThreadIds?.() ?? null,
      resolveImageAsset: assetId =>
        handlers.current.resolveImageAsset?.(assetId) ??
        Promise.resolve(undefined),
      onImageFiles: (instance, files, position) =>
        handlers.current.onImageFiles?.(instance, files, position),
    }),
    content: '',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Markdown document',
      },
    },
    onUpdate: ({ editor: instance }) => {
      handlers.current.onDocChanged?.(instance)
    },
  })

  const loadedId = useRef<string | null>(null)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (!activeId || !initialDoc) return
    // Only reload when a *different* document is opened. Re-running on every
    // autosave would stomp the caret and re-emit updates forever.
    if (loadedId.current === activeId) return

    loadedId.current = activeId
    editor.commands.setContent(initialDoc, { emitUpdate: false })
    handlers.current.onDocumentLoaded?.(activeId)
  }, [editor, activeId, initialDoc])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(
      editor.state.tr.setMeta(COMMENT_SANITIZER_RECHECK, true),
    )
  }, [editor, commentThreadRevision])

  return editor
}
