import type { Editor } from '@tiptap/core'
import { getMarkRange } from '@tiptap/core'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  COMMENT_MARK_NAME,
  nextThreadAfter,
  previousThreadBefore,
} from '../editor/extensions/comment'
import { setActiveThread } from '../editor/extensions/commentActive'
import { clearSearch, findMatches } from '../editor/extensions/search'
import { hrefAt, linkRangeAt } from '../editor/linkActions'
import type { OutlineEntry } from '../editor/outline'
import { caretFor, collectOutline, stepHeading } from '../editor/outline'
import { useMarkdownEditor } from '../editor/useMarkdownEditor'
import { getDocumentAsset } from '../db/assets'
import { DB_OUTDATED_EVENT } from '../db/client'
import { useDebouncedCallback } from '../hooks/useDebouncedCallback'
import { useDocuments } from '../hooks/useDocuments'
import { useDocumentStats } from '../hooks/useDocumentStats'
import { useDocumentFont } from '../hooks/useDocumentFont'
import { useDocumentTextSize } from '../hooks/useDocumentTextSize'
import { useFileDrop } from '../hooks/useFileDrop'
import { useFileLaunch } from '../hooks/useFileLaunch'
import { useOnline } from '../hooks/useOnline'
import { usePersistentStorage } from '../hooks/usePersistentStorage'
import { usePwaUpdate } from '../hooks/usePwaUpdate'
import { useRailHidden } from '../hooks/useRailHidden'
import { useStorageEstimate } from '../hooks/useStorageEstimate'
import { CommentEndnotes } from './CommentEndnotes'
import { useFocusMode } from '../hooks/useFocusMode'
import { useTheme } from '../hooks/useTheme'
import { useThreads } from '../hooks/useThreads'
import { useVaultSync } from '../hooks/useVaultSync'
import { insertImageFiles } from '../images/insert'
import {
  localizeRemoteImage,
  type ImageReplacementTarget,
  replaceImageWithCrop,
} from '../images/transform'
import type { ImageUrlInsertRequest } from '../images/url'
import { fetchImageFile, insertImageUrl } from '../images/url'
import { titleFor } from '../keys/catalog'
import type { OverlayId } from '../keys/context'
import { buildPaletteEntries } from '../keys/paletteEntries'
import { toPaletteActions } from '../keys/registry'
import { useCommands } from '../keys/useCommands'
import { usePeek } from '../keys/usePeek'
import { pageTitle } from '../lib/title'
import { PeekHud } from './keys/PeekHud'
import { ShortcutSheet } from './keys/ShortcutSheet'
import { buildDocxExport } from '../docx'
import { buildDocumentExport, downloadFile } from '../markdown/bundle'
import { resolveSelector } from '../markdown/anchors'
import { toMarkdown } from '../markdown/export'
import { downloadHtml, toAnnotatedHtml } from '../markdown/exportHtml'
import type { SnapshotRecord } from '../types'
import type { SyncConflictRecord } from '../types'
import { restoreConflict } from '../sync/local'
import type { PaletteAction } from './CommandPalette'
import { CommandPalette } from './CommandPalette'
import { DropOverlay } from './DropOverlay'
import { PwaPrompt } from './PwaPrompt'
import { StatusBar } from './StatusBar'
import { ThemeToggle } from './ThemeToggle'
import { UndoToast } from './UndoToast'
import { CommentSidebar } from './comments/CommentSidebar'
import { HistoryPanel } from './history/HistoryPanel'
import type { SearchHit } from './search/SearchPanel'
import { SearchPanel } from './search/SearchPanel'
import { BrandMark, HistoryIcon, SearchIcon } from './icons'
import { DocumentList } from './documents/DocumentList'
import { DocumentFontMenu } from './DocumentFontMenu'
import { DocumentTextSizeMenu } from './DocumentTextSizeMenu'
import { ExportMenu } from './documents/ExportMenu'
import { EditorSurface } from './editor/EditorSurface'
import { FindBar } from './editor/FindBar'
import { ImageBubbleMenu } from './editor/ImageBubbleMenu'
import { LinkHoverCard } from './editor/LinkHoverCard'
import type { LinkTarget } from './editor/LinkPopover'
import { LinkPopover } from './editor/LinkPopover'
import { SelectionBubbleMenu } from './editor/SelectionBubbleMenu'
import { SlashCommandMenu } from './editor/SlashCommandMenu'
import { TableBubbleMenu } from './editor/TableBubbleMenu'
import { Toolbar } from './editor/Toolbar'
import { VaultMenu } from './sync/VaultMenu'

const AUTOSAVE_DELAY_MS = 800

const ImageCropDialog = lazy(() =>
  import('./editor/ImageCropDialog').then(module => ({
    default: module.ImageCropDialog,
  })),
)

interface CropSession {
  docId: string
  source: Blob
  alt: string
  target: ImageReplacementTarget
  displayWidth: number
}

function imageTargetAt(
  editor: Editor,
  position: number,
): ImageReplacementTarget | null {
  const node = editor.state.doc.nodeAt(position)
  if (node?.type.name !== 'image' || typeof node.attrs.src !== 'string') {
    return null
  }
  return {
    position,
    expectedSrc: node.attrs.src,
    expectedAssetId:
      typeof node.attrs.assetId === 'string' ? node.attrs.assetId : null,
  }
}

function imageDisplayWidth(editor: Editor, position: number): number {
  const dom = editor.view.nodeDOM(position)
  const image =
    dom instanceof HTMLImageElement
      ? dom
      : dom instanceof Element
        ? dom.querySelector('img')
        : null
  const rendered = image?.getBoundingClientRect().width ?? 0
  const nodeWidth = editor.state.doc.nodeAt(position)?.attrs.width
  return rendered || (typeof nodeWidth === 'number' ? nodeWidth : 0)
}

export function AppShell() {
  const documents = useDocuments()
  const persistence = usePersistentStorage()
  const storage = useStorageEstimate()
  const threads = useThreads(documents.activeId, documents.contentRevision)
  const pwa = usePwaUpdate()
  const theme = useTheme()
  const focus = useFocusMode()
  const documentFont = useDocumentFont()
  const documentTextSize = useDocumentTextSize()
  const online = useOnline()
  const rail = useRailHidden()

  const [draftRange, setDraftRange] = useState<{
    from: number
    to: number
  } | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findRequest, setFindRequest] = useState(0)
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  /*
   * A quiet confirmation, distinct from `notice`.
   *
   * `notice` is a `role="alert"` with a dismiss button and a six-second life —
   * right for "the image could not be added", wrong for "Version saved", which
   * nobody needs interrupted or asked to acknowledge.
   */
  const [flash, setFlash] = useState<string | null>(null)
  /*
   * A hit in another document cannot be jumped to from the click handler:
   * `select` only sets `initialDoc`, and the editor applies it on the next
   * commit. So park the intent and let the load edge deliver it.
   *
   * A ref rather than state, unlike `pendingOrphanScroll` below: nothing
   * renders from this, and the editor calls us imperatively rather than us
   * waiting for an effect, so a re-render would buy nothing.
   */
  const pendingJump = useRef<SearchHit | null>(null)
  const [undo, setUndo] = useState<{ id: string; message: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cropSession, setCropSession] = useState<CropSession | null>(null)
  // Another tab upgraded the schema and took our connection with it. Nothing
  // this tab writes from here on will land.
  const [dbOutdated, setDbOutdated] = useState(false)
  const pairingAttempted = useRef(false)

  // Owned here rather than inside the sidebar so the status bar's orphan chip,
  // its sibling, can scroll the section into view.
  const orphanSection = useRef<HTMLElement>(null)
  // The chip can be clicked while the rail is hidden, and the section it wants
  // does not exist until the rail has mounted — so the scroll is deferred to an
  // effect rather than run in the handler.
  const [pendingOrphanScroll, setPendingOrphanScroll] = useState(false)

  const { activeId, save } = documents
  const activeDocument = useRef(activeId)
  activeDocument.current = activeId
  const { getKnownIds, onAnchorsChanged, setActiveId } = threads
  // Destructured because the hook returns a fresh object each render; the
  // callbacks inside it are stable, the wrapper is not.
  const { show: showRail, toggle: toggleRail } = rail

  useEffect(() => {
    const previousTitle = document.title
    document.title = pageTitle(documents.activeTitle)
    return () => {
      document.title = previousTitle
    }
  }, [documents.activeTitle])

  const resolveImageAsset = useCallback(
    async (assetId: string) => {
      if (!activeId) return undefined
      return (await getDocumentAsset(activeId, assetId))?.blob
    },
    [activeId],
  )

  const addImageFiles = useCallback(
    (instance: Editor, files: File[], position?: number) => {
      if (!activeId) return
      void insertImageFiles({
        editor: instance,
        docId: activeId,
        files,
        isCurrent: () => activeDocument.current === activeId,
        position,
      }).catch(error => {
        console.error('[images] insertion failed', error)
        setNotice(
          error instanceof Error
            ? error.message
            : 'The image could not be added',
        )
      })
    },
    [activeId],
  )

  /*
   * The search-hit jump needs the editor, so it is defined far below this
   * point — but useMarkdownEditor has to be handed something now. The hook
   * reads its handlers through a ref anyway, so a stable indirection costs
   * nothing and keeps the definition next to the rest of the search wiring.
   */
  const documentLoaded = useRef<(docId: string) => void>(() => {})

  const autosave = useDebouncedCallback(
    async (docId: string, editor: Editor) => {
      // Canonical PM JSON plus derived markdown, written together so the two
      // never disagree about what the document says.
      await save(docId, editor.getJSON(), toMarkdown(editor))
    },
    AUTOSAVE_DELAY_MS,
  )
  const { schedule, flush } = autosave
  const vaultSync = useVaultSync(documents.refreshFromStorage, flush)

  useEffect(() => {
    if (pairingAttempted.current || !window.location.hash) return
    pairingAttempted.current = true
    void vaultSync
      .claimPairingFromLocation()
      .then(claimed => {
        if (claimed) setNotice('This computer is now paired with the encrypted vault')
      })
      .catch(error => {
        setNotice(error instanceof Error ? error.message : 'The pairing link could not be used')
      })
  }, [vaultSync])

  const onDocChanged = useCallback(
    (editor: Editor) => {
      if (activeId) schedule(activeId, editor)
    },
    [activeId, schedule],
  )

  const editor = useMarkdownEditor({
    activeId: documents.activeId,
    initialDoc: documents.initialDoc,
    reloadToken: documents.contentRevision,
    onDocChanged,
    onAnchorsChanged,
    getKnownThreadIds: getKnownIds,
    resolveImageAsset,
    onImageFiles: addImageFiles,
    onDocumentLoaded: docId => documentLoaded.current(docId),
  })

  const insertImagesAt = useCallback(
    (files: File[], position: number) => {
      if (!editor || editor.isDestroyed) return
      addImageFiles(editor, files, position)
    },
    [addImageFiles, editor],
  )

  const addImageUrl = useCallback(
    async (request: ImageUrlInsertRequest) => {
      if (!activeId || !editor || editor.isDestroyed) return
      await insertImageUrl({
        ...request,
        editor,
        docId: activeId,
        isCurrent: () => activeDocument.current === activeId,
      })
    },
    [activeId, editor],
  )

  const localizeImage = useCallback(
    (position: number) => {
      if (!activeId || !editor || editor.isDestroyed) return
      const target = imageTargetAt(editor, position)
      if (!target || target.expectedAssetId) return
      void localizeRemoteImage(
        editor,
        activeId,
        target,
        () => activeDocument.current === activeId,
      )
        .then(() => setNotice('Image saved locally'))
        .catch(error => {
          console.error('[images] localization failed', error)
          setNotice(
            error instanceof Error
              ? error.message
              : 'The image could not be saved locally',
          )
        })
    },
    [activeId, editor],
  )

  const startImageCrop = useCallback(
    (position: number) => {
      if (!activeId || !editor || editor.isDestroyed) return
      const target = imageTargetAt(editor, position)
      const node = editor.state.doc.nodeAt(position)
      if (!target || node?.type.name !== 'image') return

      void (async () => {
        let source: Blob
        let mimeType: string
        if (target.expectedAssetId) {
          const asset = await getDocumentAsset(activeId, target.expectedAssetId)
          if (!asset) throw new Error('The image is missing from browser storage')
          source = asset.blob
          mimeType = asset.mimeType
        } else {
          const confirmed = window.confirm(
            'Cropping a remote image requires saving a local copy first. Continue?',
          )
          if (!confirmed) return
          setNotice('Downloading image for cropping…')
          const file = await fetchImageFile(target.expectedSrc)
          source = file
          mimeType = file.type
        }

        if (mimeType === 'image/gif') {
          throw new Error('GIF cropping is disabled to preserve animation')
        }
        if (activeDocument.current !== activeId) return

        setNotice(null)
        setCropSession({
          docId: activeId,
          source,
          alt: typeof node.attrs.alt === 'string' ? node.attrs.alt : '',
          target,
          displayWidth: imageDisplayWidth(editor, position),
        })
      })().catch(error => {
        console.error('[images] crop setup failed', error)
        setNotice(
          error instanceof Error ? error.message : 'The image could not be cropped',
        )
      })
    },
    [activeId, editor],
  )

  useEffect(() => {
    setCropSession(session =>
      session && session.docId !== activeId ? null : session,
    )
  }, [activeId])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  // Declared after the editor so its immediate measurement runs after the
  // setContent effect that opens a document — that call passes
  // `emitUpdate: false`, so nothing else would trigger a first reading.
  const stats = useDocumentStats(editor, documents.activeId)

  const counts = useMemo(() => {
    let open = 0
    let resolved = 0
    let orphaned = 0
    for (const thread of threads.threads) {
      if (thread.status === 'open') open += 1
      else if (thread.status === 'resolved') resolved += 1
      else orphaned += 1
    }
    return { open, resolved, orphaned }
  }, [threads.threads])

  // `save` writes the fresh record back into list state, so this tracks the
  // last successful write rather than when the document was opened.
  const savedAt =
    documents.documents.find(record => record.id === documents.activeId)
      ?.updatedAt ?? null

  // A hidden tab may be frozen or discarded without further events, so commit
  // whatever is queued at that point rather than betting on the timer.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [flush])

  // Editor -> sidebar: moving the caret into a commented range selects it.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const syncFromCaret = () => {
      const type = editor.schema.marks[COMMENT_MARK_NAME]
      if (!type) return
      const range = getMarkRange(editor.state.selection.$from, type)
      if (!range) return

      const mark = editor.state.doc
        .resolve(range.from)
        .marks()
        .find(candidate => candidate.type === type)
      const threadId = mark?.attrs.threadId as string | undefined
      if (!threadId) return

      setActiveId(threadId)
      setActiveThread(editor, threadId)
    }

    editor.on('selectionUpdate', syncFromCaret)
    return () => {
      editor.off('selectionUpdate', syncFromCaret)
    }
  }, [editor, setActiveId])

  const startDraft = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    const { from, to } = editor.state.selection
    if (from === to) return
    setDraftRange({ from, to })
  }, [editor])

  /**
   * Open the link popover on whatever the caret is touching.
   *
   * With a selection that is the selection; with a bare caret it is the link
   * under it, if any — which is the only way to edit an existing link without
   * having to select exactly its text first.
   */
  const startLink = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    const { state } = editor
    const { from, to, empty } = state.selection

    if (!empty) {
      setLinkTarget({ from, to, href: hrefAt(state, from) })
      return
    }

    const found = linkRangeAt(state, from)
    if (!found) return
    setLinkTarget(found)
  }, [editor])

  const exportMarkdown = useCallback(() => {
    if (!editor || editor.isDestroyed || !documents.activeId) return
    // Serialize live rather than reading the saved copy, so an export never
    // trails the last keystroke by up to the autosave delay.
    void buildDocumentExport(
      editor,
      documents.activeId,
      documents.activeTitle,
    )
      .then(file => downloadFile(file.filename, file.blob))
      .catch(error => {
        console.error('[export] failed', error)
        setNotice(
          error instanceof Error
            ? error.message
            : 'The document could not export',
        )
      })
  }, [editor, documents.activeId, documents.activeTitle])

  /**
   * The same document as a Word file.
   *
   * `threads` is what separates the two variants, and it is the only thing
   * that does: without it the render context has no comment registry and the
   * anchors have nowhere to go, exactly as the markdown serializer drops them.
   */
  const exportDocxFile = useCallback(
    (withComments: boolean) => {
      if (!editor || editor.isDestroyed || !documents.activeId) return
      void buildDocxExport(editor, {
        docId: documents.activeId,
        title: documents.activeTitle,
        threads: withComments ? threads.threads : undefined,
      })
        .then(file => downloadFile(file.filename, file.blob))
        .catch(error => {
          console.error('[docx export] failed', error)
          setNotice(
            error instanceof Error
              ? error.message
              : 'The Word file could not export',
          )
        })
    },
    [editor, documents.activeId, documents.activeTitle, threads.threads],
  )

  const exportDocx = useCallback(() => exportDocxFile(false), [exportDocxFile])
  const exportDocxAnnotated = useCallback(
    () => exportDocxFile(true),
    [exportDocxFile],
  )

  /** The document plus its comments, as a standalone `.html` file. */
  const exportAnnotated = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    void toAnnotatedHtml(editor, {
      title: documents.activeTitle,
      threads: threads.threads,
      resolveAsset: resolveImageAsset,
    })
      .then(html => downloadHtml(documents.activeTitle, html))
      .catch(error => {
        console.error('[html export] failed', error)
        setNotice(
          error instanceof Error ? error.message : 'The HTML could not export',
        )
      })
  }, [editor, documents.activeTitle, resolveImageAsset, threads.threads])

  const stepThread = useCallback(
    (delta: -1 | 1) => {
      if (!editor || editor.isDestroyed) return

      const type = editor.schema.marks[COMMENT_MARK_NAME]
      if (!type) return

      // Resolved anchors are still in the document, but the chip counts open
      // threads — cycling through cards the sidebar hides by default would not
      // match what the user clicked.
      const open = new Set(
        threads.threads
          .filter(thread => thread.status === 'open')
          .map(thread => thread.id),
      )

      // Searching from `to` forwards and `from` backwards is what keeps the pair
      // symmetric: a jump leaves the caret collapsed at the thread's start, so
      // stepping back and forward again returns to the thread you left.
      const { from, to } = editor.state.selection
      const target =
        delta === 1
          ? nextThreadAfter(editor.state.doc, type, open, to)
          : previousThreadBefore(editor.state.doc, type, open, from)
      if (!target) return

      // Jumping to a comment the rail is hiding is not a jump.
      showRail()
      editor.chain().focus().setTextSelection(target.from).scrollIntoView().run()

      // Two threads may overlap the same text, so the caret alone cannot say
      // which was meant. Set it explicitly, after the selection handler has run.
      setActiveId(target.threadId)
      setActiveThread(editor, target.threadId)
    },
    [editor, threads.threads, setActiveId, showRail],
  )

  const showOrphans = useCallback(() => {
    showRail()
    setPendingOrphanScroll(true)
  }, [showRail])

  useEffect(() => {
    if (!pendingOrphanScroll || rail.hidden) return
    // Runs after the commit that mounted the rail, so the ref is attached. If
    // the orphans went away in the meantime there is nothing to scroll to and
    // clearing the flag is the whole job.
    orphanSection.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
    setPendingOrphanScroll(false)
  }, [pendingOrphanScroll, rail.hidden])

  const goTo = useCallback(
    (entry: OutlineEntry | null) => {
      if (!entry || !editor || editor.isDestroyed) return
      editor
        .chain()
        .focus()
        .setTextSelection(caretFor(entry))
        .scrollIntoView()
        .run()
    },
    [editor],
  )

  /**
   * Both navigators re-read the outline from live editor state rather than
   * reusing the one in `stats`, which trails by the measure debounce —
   * navigating from a stale position would land off by whatever was typed
   * since. The cost is one walk of the document's top-level children.
   */
  const jumpToHeading = useCallback(
    (index: number) => {
      if (!editor || editor.isDestroyed) return
      goTo(collectOutline(editor.state.doc)[index] ?? null)
    },
    [editor, goTo],
  )

  /**
   * Put the caret on the passage a search hit came from.
   *
   * Three fallbacks deep and it never throws: an anchor that no longer resolves
   * means the document was edited since it was indexed, which is ordinary, and
   * opening the document is still the right outcome.
   */
  const jumpToHit = useCallback(
    (hit: SearchHit) => {
      if (!editor || editor.isDestroyed) return

      const term = hit.term.trim()
      const range =
        (hit.passage.anchor.exact
          ? resolveSelector(editor.state.doc, hit.passage.anchor)
          : null) ?? (term ? (findMatches(editor.state.doc, term)[0] ?? null) : null)

      if (hit.passage.threadId) {
        // A comment lives in the rail, not in the text.
        showRail()
        setActiveId(hit.passage.threadId)
        setActiveThread(editor, hit.passage.threadId)
      }

      if (range) {
        editor.chain().focus().setTextSelection(range).scrollIntoView().run()
        // Reuse the find stack so the match is highlighted in context and the
        // other occurrences are one keystroke away.
        if (term) {
          editor.commands.setSearchQuery(term)
          setFindOpen(true)
        }
      }
    },
    [editor, setActiveId, showRail],
  )

  const openHit = useCallback(
    (hit: SearchHit) => {
      if (hit.passage.trashed) {
        // `select` only knows live documents, and restore already opens it.
        pendingJump.current = hit
        void documents.restore(hit.passage.docId)
        return
      }
      if (hit.passage.docId === documents.activeId) {
        jumpToHit(hit)
        return
      }
      pendingJump.current = hit
      documents.select(hit.passage.docId)
    },
    [documents, jumpToHit],
  )

  /** Fired by useMarkdownEditor once the new content is actually in the view. */
  const onDocumentLoaded = useCallback(
    (docId: string) => {
      const hit = pendingJump.current
      if (!hit || hit.passage.docId !== docId) return
      // Cleared first: a jump that throws must not strand the intent and fire
      // again on the next unrelated document load.
      pendingJump.current = null
      jumpToHit(hit)
    },
    [jumpToHit],
  )

  documentLoaded.current = onDocumentLoaded

  const stepSection = useCallback(
    (delta: -1 | 1) => {
      if (!editor || editor.isDestroyed) return
      const { doc, selection } = editor.state
      goTo(stepHeading(collectOutline(doc), selection.from, delta))
    },
    [editor, goTo],
  )

  const openFind = useCallback(() => {
    setFindOpen(true)
    // A second ⌘F over an open bar re-selects the query rather than doing
    // nothing, which is what every other find box does.
    setFindRequest(value => value + 1)
  }, [])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    if (!editor || editor.isDestroyed) return
    // Highlights would otherwise outlive the bar that explains them.
    clearSearch(editor)
    editor.commands.focus()
  }, [editor])

  // Import creates a new document; a failed bundle never leaves a partial one.
  const importFile = useCallback(
    (file: File) => {
      void documents.importFile(file).catch(error => {
        console.error('[import] failed', error)
        setNotice(
          error instanceof Error ? error.message : 'The document could not open',
        )
      })
    },
    [documents],
  )

  // "Open with" from the OS file manager, and dropping a file on the window.
  useFileLaunch(importFile)
  const dropping = useFileDrop(importFile)

  // Dispatched by the db client when another tab upgraded the schema out from
  // under this one. Nothing listened for it before there was a migration to
  // trigger it.
  useEffect(() => {
    const onOutdated = () => setDbOutdated(true)
    window.addEventListener(DB_OUTDATED_EVENT, onOutdated)
    return () => {
      window.removeEventListener(DB_OUTDATED_EVENT, onOutdated)
    }
  }, [])

  const deleteDocument = useCallback(
    async (id: string) => {
      // Commit anything queued first, so the copy going to the trash is the
      // one the user last saw rather than the one before their last keystroke.
      await flush()
      const record = await documents.remove(id)
      if (record) setUndo({ id: record.id, message: `Deleted “${record.title}”` })
    },
    [documents, flush],
  )

  const takeSnapshot = useCallback(
    async (cause: 'manual' | 'restore') => {
      if (!editor || editor.isDestroyed || !documents.activeId) return
      await documents.snapshot(
        documents.activeId,
        editor.getJSON(),
        toMarkdown(editor),
        cause,
      )
    },
    [documents, editor],
  )

  /**
   * What ⌘S means in an app that already saves on its own.
   *
   * Without a binding the browser's own "Save page as" dialog answers instead,
   * which is actively wrong for a document that lives in this tab. Flushing
   * first is what makes the snapshot contain the last keystroke rather than
   * the one before the autosave window.
   */
  const saveVersion = useCallback(async () => {
    await flush()
    await takeSnapshot('manual')
    setFlash('Version saved')
  }, [flush, takeSnapshot])

  // Long enough to read, short enough not to sit in the corner.
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 2000)
    return () => window.clearTimeout(timer)
  }, [flash])

  /**
   * Replace the document with an older version of itself.
   *
   * Never destructive: the state being replaced is snapshotted first, and the
   * replacement itself is an ordinary undoable transaction. `emitUpdate` lets
   * the normal autosave persist it, so canonical JSON and derived markdown are
   * still written together by the one sanctioned path.
   *
   * Anchors whose thread has since been deleted are stripped on arrival by
   * CommentSanitizer — that is the sanitizer doing its job, not a loss.
   */
  const restoreSnapshot = useCallback(
    async (snapshot: SnapshotRecord) => {
      if (!editor || editor.isDestroyed) return
      await takeSnapshot('restore')
      editor.commands.setContent(snapshot.doc, { emitUpdate: true })
      setHistoryOpen(false)
      editor.commands.focus()
    },
    [editor, takeSnapshot],
  )

  const restoreSyncConflict = useCallback(
    async (conflict: SyncConflictRecord) => {
      await flush()
      await takeSnapshot('restore')
      await restoreConflict(conflict)
      await documents.refreshFromStorage()
      setHistoryOpen(false)
      setNotice('The conflict version was restored and queued for sync')
    },
    [documents, flush, takeSnapshot],
  )

  const closeSheet = useCallback(() => {
    setSheetOpen(false)
    if (editor && !editor.isDestroyed) editor.commands.focus()
  }, [editor])

  const closePalette = useCallback(() => {
    setPaletteOpen(false)
    if (editor && !editor.isDestroyed) editor.commands.focus()
  }, [editor])
  /*
   * Which overlay owns the screen, if any.
   *
   * The find bar is deliberately absent: it is docked rather than modal, and
   * the reader goes on typing in the document behind it. Its own
   * `data-keys="overlay"` marker already stands the global table down for the
   * keys it owns while it has focus, which is the narrower and correct rule.
   */
  const overlay: OverlayId | null = paletteOpen
    ? 'palette'
    : searchOpen
      ? 'search'
      : historyOpen
        ? 'history'
        : sheetOpen
          ? 'cheatsheet'
          : cropSession
            ? 'crop'
            : null

  /**
   * The keyboard, wired.
   *
   * Everything — the bindings, the palette's command half, the cheat sheet and
   * the peek HUD — comes out of one registry built from `keys/catalog`, so a
   * chord has a single spelling and a command a single label no matter which
   * surface is showing it.
   */
  const commands = useCommands(
    {
      editor,
      documents,
      threads,
      rail,
      theme,
      focus,
      ui: {
        openPalette: () => setPaletteOpen(true),
        openSearch: () => setSearchOpen(true),
        openHistory: () => setHistoryOpen(true),
        openCheatSheet: () => setSheetOpen(true),
        openFind,
        startLink,
        startDraft,
        exportMarkdown,
        exportDocx,
        exportDocxAnnotated,
        exportAnnotated,
        stepSection,
        stepThread,
        saveVersion: () => void saveVersion(),
        deleteActive: () => {
          if (documents.activeId) void deleteDocument(documents.activeId)
        },
      },
    },
    overlay,
  )

  const peek = usePeek(overlay === null)

  /**
   * The palette's list: the commands, then what only it can offer.
   *
   * The open documents and the live heading outline are the expensive half —
   * `collectOutline` walks the document — so they stay behind the open check
   * that has always guarded them, while the commands themselves are standing
   * and feed the cheat sheet and the HUD as well.
   */
  const paletteActions = useMemo<PaletteAction[]>(
    () =>
      paletteOpen
        ? [
            ...toPaletteActions(commands.live),
            ...buildPaletteEntries({ editor, documents, jumpToHeading }),
          ]
        : [],
    [paletteOpen, commands.live, editor, documents, jumpToHeading],
  )


  const submitDraft = useCallback(
    (body: string) => {
      if (!editor || editor.isDestroyed || !draftRange) return
      // The composer stole focus, so restore the range the user highlighted
      // before applying the mark.
      editor.commands.setTextSelection(draftRange)
      void threads.addThread(editor, body)
      setDraftRange(null)
    },
    [editor, draftRange, threads],
  )

  return (
    <>
      <header className="app-header">
        <BrandMark className="app-header__brand" />

        <DocumentList
          documents={documents.documents}
          trashed={documents.trashed}
          activeId={documents.activeId}
          activeTitle={documents.activeTitle}
          onSelect={documents.select}
          onCreate={() => void documents.create()}
          onDelete={id => void deleteDocument(id)}
          onRestore={id => void documents.restore(id)}
          onDestroy={id => void documents.destroy(id)}
          onRename={(id, name) => void documents.rename(id, name)}
        />

        {editor ? (
          <Toolbar
            editor={editor}
            documentId={activeId}
            onInsertImages={(files, position) =>
              addImageFiles(editor, files, position)
            }
            onInsertImageUrl={addImageUrl}
          />
        ) : null}

        <div className="app-header__spacer" />

        <div className="app-header__tools">
          {/* Save state lives in the status bar; this row is actions only. */}
          <button
            type="button"
            className="app-header__icon"
            aria-label="Search all documents"
            title={titleFor('find.searchAll')}
            onClick={() => setSearchOpen(true)}
          >
            <SearchIcon />
          </button>

          <ExportMenu
            disabled={!editor}
            onExport={exportMarkdown}
            onExportDocx={exportDocx}
            onExportDocxAnnotated={exportDocxAnnotated}
            onExportAnnotated={exportAnnotated}
            onImport={importFile}
          />

          <button
            type="button"
            className="app-header__icon"
            disabled={!editor}
            aria-label="Version history"
            title="Version history"
            onClick={() => setHistoryOpen(true)}
          >
            <HistoryIcon />
          </button>

          <DocumentFontMenu
            font={documentFont.font}
            onSelect={documentFont.selectFont}
          />

          <DocumentTextSizeMenu
            size={documentTextSize.size}
            onSelect={documentTextSize.selectSize}
          />

          <VaultMenu sync={vaultSync} />

          <ThemeToggle theme={theme.theme} onToggle={theme.toggle} />
        </div>
      </header>

      <div
        className={rail.hidden ? 'workspace workspace--no-rail' : 'workspace'}
      >
        <EditorSurface editor={editor}>
          {editor && findOpen ? (
            <FindBar
              editor={editor}
              focusRequest={findRequest}
              onClose={closeFind}
            />
          ) : null}
        </EditorSurface>

        {/*
          Unmounted, not merely hidden. The anchors live in the document, so
          nothing about the comments is lost — this is only the view of them.
        */}
        {rail.hidden ? null : (
          <CommentSidebar
            editor={editor}
            threads={threads.threads}
            activeId={threads.activeId}
            orphanSectionRef={orphanSection}
            draftRange={draftRange}
            showResolved={showResolved}
            onToggleResolved={() => setShowResolved(value => !value)}
            onActivate={id => {
              setActiveId(id)
              if (editor && !editor.isDestroyed) setActiveThread(editor, id)
            }}
            onSubmitDraft={submitDraft}
            onCancelDraft={() => setDraftRange(null)}
            onReply={(threadId, body) => void threads.reply(threadId, body)}
            onEdit={(commentId, body) =>
              void threads.editComment(commentId, body)
            }
            onResolve={(threadId, resolved) => {
              if (editor) void threads.resolve(editor, threadId, resolved)
            }}
            onResolveAll={() => {
              if (editor) void threads.resolveAll(editor)
            }}
            onDelete={threadId => {
              if (editor) void threads.remove(editor, threadId)
            }}
            onReanchor={threadId => {
              if (editor) void threads.reanchor(editor, threadId)
            }}
          />
        )}

        {/*
          Print only, and mounted unconditionally — unlike the rail above,
          which is unmounted when collapsed. Printing with the comments hidden
          is the normal case, not an edge one, and the notes have to survive it.
        */}
        <CommentEndnotes editor={editor} threads={threads.threads} />
      </div>

      <StatusBar
        stats={stats}
        openCount={counts.open}
        resolvedCount={counts.resolved}
        orphanCount={counts.orphaned}
        online={online}
        status={documents.status}
        persistence={persistence}
        savedAt={savedAt}
        usage={storage.usage}
        railHidden={rail.hidden}
        syncStatus={vaultSync.status}
        onStepThread={stepThread}
        onShowOrphans={showOrphans}
        onJumpToHeading={jumpToHeading}
        onStepSection={stepSection}
        onToggleRail={toggleRail}
      />

      {editor ? (
        <SelectionBubbleMenu
          editor={editor}
          onAddComment={startDraft}
          onAddLink={startLink}
        />
      ) : null}

      {editor ? (
        <SlashCommandMenu
          editor={editor}
          onAddComment={startDraft}
          onAddLink={startLink}
          onInsertImages={insertImagesAt}
        />
      ) : null}

      {editor ? <TableBubbleMenu editor={editor} /> : null}

      {editor ? (
        <ImageBubbleMenu
          editor={editor}
          onCrop={startImageCrop}
          onLocalize={localizeImage}
        />
      ) : null}

      {editor && activeId === cropSession?.docId ? (
        <Suspense
          fallback={
            <div className="crop-dialog-backdrop" role="status">
              Loading image editor…
            </div>
          }
        >
          <ImageCropDialog
            source={cropSession.source}
            alt={cropSession.alt}
            onClose={() => setCropSession(null)}
            onApply={canvas =>
              replaceImageWithCrop(
                editor,
                cropSession.docId,
                cropSession.target,
                canvas,
                cropSession.displayWidth,
                () => activeDocument.current === cropSession.docId,
              )
            }
          />
        </Suspense>
      ) : null}

      {paletteOpen ? (
        <CommandPalette actions={paletteActions} onClose={closePalette} />
      ) : null}

      {searchOpen ? (
        <SearchPanel
          onClose={() => setSearchOpen(false)}
          onOpenHit={openHit}
          flushPendingWrites={flush}
          storageRevision={documents.contentRevision}
          corpusCount={documents.documents.length}
        />
      ) : null}

      {sheetOpen ? (
        <ShortcutSheet
          commands={commands.all}
          context={commands.context}
          onClose={closeSheet}
        />
      ) : null}

      <PeekHud held={peek} commands={commands.live} />

      {historyOpen && editor && documents.activeId ? (
        <HistoryPanel
          docId={documents.activeId}
          current={toMarkdown(editor)}
          onRestore={snapshot => void restoreSnapshot(snapshot)}
          onRestoreConflict={conflict => void restoreSyncConflict(conflict)}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}

      {editor ? (
        <LinkHoverCard
          editor={editor}
          suppressed={linkTarget !== null}
          onEdit={setLinkTarget}
        />
      ) : null}

      {editor && linkTarget ? (
        <LinkPopover
          editor={editor}
          target={linkTarget}
          onClose={() => setLinkTarget(null)}
        />
      ) : null}

      {dropping ? <DropOverlay /> : null}

      {undo ? (
        <UndoToast
          message={undo.message}
          onUndo={() => {
            void documents.restore(undo.id)
            setUndo(null)
          }}
          onDismiss={() => setUndo(null)}
        />
      ) : null}

      {dbOutdated ? (
        <div className="toast" role="alert">
          <span>
            Another tab updated the app. Reload this one before editing further.
          </span>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : null}

      {flash && !notice && !dbOutdated ? (
        // role="status", not "alert": polite, so it does not interrupt a
        // screen reader mid-sentence for something the reader asked for.
        <div className="toast" role="status">
          <span>{flash}</span>
        </div>
      ) : null}

      {notice && !dbOutdated ? (
        <div className="toast" role="alert">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <PwaPrompt
        needRefresh={pwa.needRefresh}
        offlineReady={pwa.offlineReady}
        onUpdate={() =>
          void pwa.update(async () => {
            await flush()
            await vaultSync.syncNow().catch(() => undefined)
          })
        }
        onDismissUpdate={pwa.dismissUpdate}
        onDismissOfflineReady={pwa.dismissOfflineReady}
      />
    </>
  )
}
