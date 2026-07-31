import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import type { ImageUrlInsertRequest } from '../../images/url'
import { titleFor } from '../../keys/catalog'
import {
  BulletListIcon,
  CodeBlockIcon,
  HorizontalRuleIcon,
  ImageIcon,
  JustifyIcon,
  OrderedListIcon,
  QuoteIcon,
  RedoIcon,
  TableIcon,
  TaskListIcon,
  UndoIcon,
} from '../icons'
import { ImageInsertPopover } from './ImageInsertPopover'

interface ToolbarProps {
  editor: Editor
  documentId: string | null
  onInsertImages: (files: File[], position?: number) => void
  onInsertImageUrl: (request: ImageUrlInsertRequest) => Promise<void>
}

/**
 * Note there is deliberately no underline button: Underline is not in the
 * schema because it serializes to `++text++`, which is neither CommonMark nor
 * GFM. See src/markdown/config.ts.
 */
export function Toolbar({
  editor,
  documentId,
  onInsertImages,
  onInsertImageUrl,
}: ToolbarProps) {
  const [imageInsertPosition, setImageInsertPosition] = useState<number | null>(
    null,
  )
  const imageButton = useRef<HTMLButtonElement>(null)
  useEffect(() => setImageInsertPosition(null), [documentId])
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      justify: e.isActive('paragraph', { textAlign: 'justify' }),
      canJustify: e.can().setTextAlign('justify'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="toolbar__group">
        <button
          type="button"
          title={titleFor('format.bold')}
          aria-label="Bold"
          aria-pressed={state.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          title={titleFor('format.italic')}
          aria-label="Italic"
          aria-pressed={state.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          title={titleFor('format.strike')}
          aria-label="Strikethrough"
          aria-pressed={state.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <s>S</s>
        </button>
        <button
          type="button"
          title={titleFor('format.code')}
          aria-label="Inline code"
          aria-pressed={state.code}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          {'</>'}
        </button>
      </div>

      <div className="toolbar__sep" />

      <div className="toolbar__group">
        {([1, 2, 3] as const).map(level => (
          <button
            key={level}
            type="button"
            title={titleFor(`format.h${level}` as const)}
            aria-label={`Heading ${level}`}
            aria-pressed={state[`h${level}` as 'h1' | 'h2' | 'h3']}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level }).run()
            }
          >
            H{level}
          </button>
        ))}
        <button
          type="button"
          title={titleFor('format.justify')}
          aria-label="Justify paragraph"
          aria-pressed={state.justify}
          disabled={!state.canJustify}
          onClick={() =>
            (state.justify
              ? editor.chain().focus().unsetTextAlign()
              : editor.chain().focus().setTextAlign('justify')
            ).run()
          }
        >
          <JustifyIcon />
        </button>
      </div>

      <div className="toolbar__sep" />

      <div className="toolbar__group">
        <button
          type="button"
          title={titleFor('format.bulletList')}
          aria-label="Bullet list"
          aria-pressed={state.bulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <BulletListIcon />
        </button>
        <button
          type="button"
          title={titleFor('format.orderedList')}
          aria-label="Numbered list"
          aria-pressed={state.orderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <OrderedListIcon />
        </button>
        <button
          type="button"
          title={titleFor('format.taskList')}
          aria-label="Task list"
          aria-pressed={state.taskList}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <TaskListIcon />
        </button>
      </div>

      <div className="toolbar__sep" />

      <div className="toolbar__group">
        <button
          type="button"
          title={titleFor('format.blockquote')}
          aria-label="Blockquote"
          aria-pressed={state.blockquote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <QuoteIcon />
        </button>
        <button
          type="button"
          title={titleFor('format.codeBlock')}
          aria-label="Code block"
          aria-pressed={state.codeBlock}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <CodeBlockIcon />
        </button>
        <button
          type="button"
          title={titleFor('insert.table')}
          aria-label="Insert table"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <TableIcon />
        </button>
        <button
          type="button"
          title={titleFor('insert.rule')}
          aria-label="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <HorizontalRuleIcon />
        </button>
        <span className="image-insert-trigger">
          <button
            ref={imageButton}
            type="button"
            title={titleFor('insert.image')}
            aria-label="Insert image"
            aria-expanded={imageInsertPosition !== null}
            onMouseDown={event => event.stopPropagation()}
            onClick={() =>
              setImageInsertPosition(current =>
                current === null ? editor.state.selection.from : null,
              )
            }
          >
            <ImageIcon />
          </button>
          {imageInsertPosition !== null ? (
            <ImageInsertPopover
              anchor={imageButton.current?.getBoundingClientRect() ?? null}
              position={imageInsertPosition}
              onClose={() => setImageInsertPosition(null)}
              onInsertFiles={onInsertImages}
              onInsertUrl={onInsertImageUrl}
            />
          ) : null}
        </span>
      </div>

      <div className="toolbar__sep" />

      <div className="toolbar__group">
        <button
          type="button"
          title={titleFor('format.undo')}
          aria-label="Undo"
          disabled={!state.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          title={titleFor('format.redo')}
          aria-label="Redo"
          disabled={!state.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <RedoIcon />
        </button>
      </div>
    </div>
  )
}
