import { useEffect, useRef } from 'react'
import { CloseIcon } from '../icons'
import { DocumentLibrary } from './DocumentLibrary'

type LibraryProps = Omit<
  Parameters<typeof DocumentLibrary>[0],
  'onOpened'
>

interface LibrarySidebarProps extends LibraryProps {
  /**
   * True on a narrow screen, where the sidebar slides over the editor instead
   * of taking a column beside it. Everything that differs between the two —
   * the backdrop, Escape, closing after you open something, where focus goes —
   * hangs off this one flag.
   */
  drawer: boolean
  onClose: () => void
}

/**
 * The library's housing.
 *
 * Docked, it is a column of the workspace grid and behaves like a fixture: it
 * does not close when you pick something, and it never covers the text. As a
 * drawer it is the same panel on top of the editor, and then it does close —
 * a panel over the thing you just asked to see has stopped being useful.
 */
export function LibrarySidebar({
  drawer,
  onClose,
  ...library
}: LibrarySidebarProps) {
  const panel = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!drawer) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [drawer, onClose])

  useEffect(() => {
    // Only the drawer takes focus. Docking is a layout change the user asked
    // for while typing, and stealing the caret out of the document for it
    // would be the panel deciding it matters more than the sentence.
    if (drawer) panel.current?.focus()
  }, [drawer])

  return (
    <>
      {drawer ? (
        // Not a button: it is a dismiss surface, and announcing it as a control
        // would put a nameless one in front of the whole list.
        <div className="library__scrim" onMouseDown={onClose} />
      ) : null}

      <aside
        ref={panel}
        className={drawer ? 'library library--drawer' : 'library'}
        aria-label="Library"
        tabIndex={-1}
        // Global chords stand down while the drawer owns the screen, exactly
        // as they do for the palette and the search panel.
        data-keys={drawer ? 'overlay' : undefined}
      >
        <header className="library__header">
          <h2 className="library__heading">Library</h2>
          <button
            type="button"
            className="library__close"
            aria-label="Close library"
            title="Close library"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <DocumentLibrary {...library} onOpened={drawer ? onClose : undefined} />
      </aside>
    </>
  )
}
