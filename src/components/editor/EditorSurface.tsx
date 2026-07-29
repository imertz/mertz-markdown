import type { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import type { ReactNode } from 'react'

interface EditorSurfaceProps {
  editor: Editor | null
  /**
   * Panels docked over the text — the find bar. They live inside the pane so
   * they can stick to the top of the scroll container, and each is responsible
   * for taking itself out of flow: anything that occupies height here pushes
   * the text down without moving the comment rail, and every card in the rail
   * is then off by that much until the next relayout.
   */
  children?: ReactNode
}

export function EditorSurface({ editor, children }: EditorSurfaceProps) {
  return (
    <main className="editor-pane">
      {children}
      <div className="editor-pane__inner">
        <EditorContent editor={editor} />
      </div>
    </main>
  )
}
