import type { Editor } from '@tiptap/core'
import type { PaletteAction } from '../components/CommandPalette'
import { collectOutline } from '../editor/outline'
import type { DocumentsApi } from '../hooks/useDocuments'
import { relative } from '../lib/time'

/**
 * The half of the palette that is not commands.
 *
 * Split out from the registry by cost rather than by kind: everything here
 * walks something — the document list, the heading outline — so it is built
 * only while the palette is actually open, whereas the commands are standing
 * and feed the cheat sheet and the peek HUD too.
 */
export function buildPaletteEntries(input: {
  editor: Editor | null
  documents: DocumentsApi
  jumpToHeading: (index: number) => void
}): PaletteAction[] {
  const { editor, documents, jumpToHeading } = input

  const openDocuments: PaletteAction[] = documents.documents
    .filter(record => record.id !== documents.activeId)
    .map(record => ({
      id: `doc:${record.id}`,
      label: record.title,
      hint: `Document · ${relative(record.updatedAt)}`,
      run: () => documents.select(record.id),
    }))

  // Live editor state, not the debounced copy in `stats`: a heading typed a
  // second ago has to be reachable, and its position has to be current.
  const headings: PaletteAction[] =
    editor && !editor.isDestroyed
      ? collectOutline(editor.state.doc).map((entry, index) => ({
          id: `heading:${index}`,
          label: entry.text || 'Untitled section',
          hint: `Heading ${entry.level}`,
          run: () => jumpToHeading(index),
        }))
      : []

  return [...openDocuments, ...headings]
}
