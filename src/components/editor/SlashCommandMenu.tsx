import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  consumeSlashCommand,
  dismissSlashCommand,
  slashCommandKey,
} from '../../editor/extensions/slashCommands'
import { IMAGE_ACCEPT } from '../../images/files'
import {
  metaFor,
  type CommandId,
} from '../../keys/catalog'
import { CloseIcon } from '../icons'

type MenuItem = {
  id: string
  commandId: CommandId
  label: string
  description: string
  keywords: readonly string[]
  disabled?: boolean
  run?: () => void
}

interface SlashCommandMenuProps {
  editor: Editor
  onAddComment: () => void
  onAddLink: () => void
  onInsertImages: (files: File[], position: number) => void
}

function itemMatches(item: MenuItem, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [item.label, item.description, ...item.keywords]
    .join(' ')
    .toLowerCase()
    .includes(needle)
}

function toMenuItem(
  commandId: CommandId,
  description: string,
  run: () => void,
): MenuItem {
  const meta = metaFor(commandId)
  return {
    id: commandId,
    commandId,
    label: meta.label,
    description,
    keywords: meta.menuKeywords ?? [],
    run,
  }
}

export function SlashCommandMenu({
  editor,
  onAddComment,
  onAddLink,
  onInsertImages,
}: SlashCommandMenuProps) {
  const slash =
    useEditorState({
      editor,
      selector: ({ editor: instance }) =>
        slashCommandKey.getState(instance.state) ?? null,
    }) ?? null
  const [cursor, setCursor] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const imageInput = useRef<HTMLInputElement>(null)
  const imagePosition = useRef<number | null>(null)
  const [position, setPosition] = useState({ left: 24, top: 96 })

  const close = useCallback(() => {
    dismissSlashCommand(editor)
    setCursor(0)
  }, [editor])

  const consume = useCallback(() => {
    if (!slash) return null
    return consumeSlashCommand(editor, slash)
  }, [editor, slash])

  const runAtInsertionPoint = useCallback(
    (run: (position: number) => void) => {
      const insertionPoint = consume()
      if (insertionPoint === null) return
      run(insertionPoint)
      setCursor(0)
    },
    [consume],
  )

  const runPlaceholderAction = useCallback(
    (value: 'comment' | 'link') => {
      const insertionPoint = consume()
      if (insertionPoint === null) return
      const label = value === 'comment' ? 'comment' : 'link'
      editor
        .chain()
        .focus()
        .insertContentAt(insertionPoint, label)
        .setTextSelection({
          from: insertionPoint,
          to: insertionPoint + label.length,
        })
        .run()
      if (value === 'comment') onAddComment()
      else onAddLink()
      setCursor(0)
    },
    [consume, editor, onAddComment, onAddLink],
  )

  const chooseImage = useCallback(() => {
    const insertionPoint = consume()
    if (insertionPoint === null) return
    imagePosition.current = insertionPoint
    imageInput.current?.click()
    setCursor(0)
  }, [consume])

  const rootItems = useMemo<MenuItem[]>(() => {
    return [
      toMenuItem('format.h1', 'A large section title', () =>
        runAtInsertionPoint(position => {
          editor
            .chain()
            .focus()
            .setTextSelection(position)
            .setHeading({ level: 1 })
            .run()
        }),
      ),
      toMenuItem('format.h2', 'A section title', () =>
        runAtInsertionPoint(position => {
          editor
            .chain()
            .focus()
            .setTextSelection(position)
            .setHeading({ level: 2 })
            .run()
        }),
      ),
      toMenuItem('format.h3', 'A small section title', () =>
        runAtInsertionPoint(position => {
          editor
            .chain()
            .focus()
            .setTextSelection(position)
            .setHeading({ level: 3 })
            .run()
        }),
      ),
      toMenuItem('format.taskList', 'A checklist with open items', () =>
        runAtInsertionPoint(position => {
          editor
            .chain()
            .focus()
            .setTextSelection(position)
            .toggleTaskList()
            .run()
        }),
      ),
      toMenuItem('insert.table', 'A clean GFM table', () => {
        const insertionPoint = consume()
        if (insertionPoint === null) return
        editor
          .chain()
          .focus()
          .setTextSelection(insertionPoint)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run()
        setCursor(0)
      }),
      toMenuItem('insert.image', 'Choose a local image file', chooseImage),
      toMenuItem('comment.add', 'Annotate a selected placeholder', () =>
        runPlaceholderAction('comment'),
      ),
      toMenuItem('insert.link', 'Add a URL to a selected placeholder', () =>
        runPlaceholderAction('link'),
      ),
    ]
  }, [chooseImage, consume, editor, runAtInsertionPoint, runPlaceholderAction])

  const items = useMemo(
    () => rootItems.filter(item => itemMatches(item, slash?.query ?? '')),
    [rootItems, slash?.query],
  )
  const active = Math.min(cursor, Math.max(0, items.length - 1))
  const activeItemId = items[active]?.id ?? null

  useEffect(() => {
    setCursor(0)
  }, [slash?.query])

  useEffect(() => {
    if (!activeItemId) return
    itemRefs.current.get(activeItemId)?.scrollIntoView({ block: 'nearest' })
  }, [activeItemId])

  useLayoutEffect(() => {
    if (!slash) return

    const reposition = () => {
      if (editor.isDestroyed) return
      try {
        const rect = editor.view.coordsAtPos(slash.to)
        const height = menuRef.current?.getBoundingClientRect().height ?? 300
        const width = menuRef.current?.getBoundingClientRect().width ?? 350
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
        const below = rect.bottom + 8
        const top =
          below + height <= window.innerHeight - 12
            ? below
            : Math.max(12, rect.top - height - 8)
        setPosition({ left, top })
      } catch {
        setPosition({ left: 24, top: 96 })
      }
    }

    reposition()
    const workspace = editor.view.dom.closest('.workspace')
    workspace?.addEventListener('scroll', reposition, { passive: true })
    window.addEventListener('resize', reposition)
    return () => {
      workspace?.removeEventListener('scroll', reposition)
      window.removeEventListener('resize', reposition)
    }
  }, [editor, slash])

  useEffect(() => {
    if (!slash) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        if (!items.length) return
        setCursor(current => {
          const next = event.key === 'ArrowDown' ? current + 1 : current - 1
          return (next + items.length) % items.length
        })
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[active]
        if (!item) return
        event.preventDefault()
        event.stopPropagation()
        if (!item.disabled) {
          item.run?.()
        }
      }
    }

    // Capture before ProseMirror's keymap so Enter never creates a paragraph
    // behind the menu and arrows never move the caret while it is open.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, close, editor, items, slash])

  const imagePicker = (
    <input
      ref={imageInput}
      type="file"
      accept={IMAGE_ACCEPT}
      multiple
      hidden
      onChange={event => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        const insertionPoint = imagePosition.current
        imagePosition.current = null
        if (files.length && insertionPoint !== null) {
          onInsertImages(files, insertionPoint)
        }
      }}
    />
  )

  if (!slash) return imagePicker

  const headingText = slash.query || 'command'

  return (
    <>
      <div
        ref={menuRef}
        className="slash-command-menu"
        role="dialog"
        aria-label="Slash commands"
        data-keys="overlay"
        style={{ left: `${position.left}px`, top: `${position.top}px` }}
      >
        <header className="slash-command-menu__header">
          <div className="slash-command-menu__query" aria-live="polite">
            <span className="slash-command-menu__slash">/</span>
            <span>{headingText}</span>
          </div>
          <button
            type="button"
            className="slash-command-menu__close"
            aria-label="Dismiss slash commands"
            onMouseDown={event => event.preventDefault()}
            onClick={close}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="slash-command-menu__body" role="listbox" aria-label="Commands">
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={element => {
                if (element) itemRefs.current.set(item.id, element)
                else itemRefs.current.delete(item.id)
              }}
              type="button"
              role="option"
              aria-selected={index === active}
              aria-disabled={item.disabled || undefined}
              className="slash-command-menu__item"
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setCursor(index)}
              onClick={() => {
                if (!item.disabled) {
                  item.run?.()
                }
              }}
            >
              <span className="slash-command-menu__item-copy">
                <span className="slash-command-menu__item-label">{item.label}</span>
                <span className="slash-command-menu__item-description">
                  {item.description}
                </span>
              </span>
            </button>
          ))}

          {!items.length ? (
            <p className="slash-command-menu__empty">No commands match “{slash.query}”</p>
          ) : null}
        </div>

        <footer className="slash-command-menu__footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> choose</span>
          <span><kbd>esc</kbd> close</span>
        </footer>
      </div>

      {imagePicker}
    </>
  )
}
