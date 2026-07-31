import { Extension, type CommandProps } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'

export type TextAlignment = 'justify'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textAlign: {
      /** Justify the selected or current paragraph(s). */
      setTextAlign: (alignment: TextAlignment) => ReturnType
      /** Restore the selected or current paragraph(s) to normal alignment. */
      unsetTextAlign: () => ReturnType
    }
  }
}

/** Paragraphs are the only blocks this control changes; headings stay left-aligned. */
const paragraphPositions = (state: EditorState): number[] => {
  const positions = new Set<number>()
  const { from, to, empty, $from } = state.selection

  if (empty) {
    if ($from.parent.type.name === 'paragraph') {
      positions.add($from.before($from.depth))
    }
    return [...positions]
  }

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'paragraph') {
      positions.add(pos)
      return false
    }
    return true
  })

  return [...positions]
}

const updateParagraphAlignment =
  (textAlign: TextAlignment | null) =>
  ({ state, tr, dispatch }: CommandProps) => {
    const positions = paragraphPositions(state)
    if (!positions.length) return false

    if (dispatch) {
      for (const pos of positions) {
        const node = tr.doc.nodeAt(pos)
        if (!node) continue
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign })
      }
    }

    return true
  }

export const TextAlign = Extension.create({
  name: 'textAlign',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: element =>
              element.style.textAlign.trim().toLowerCase() === 'justify'
                ? 'justify'
                : null,
            renderHTML: attributes =>
              attributes.textAlign === 'justify'
                ? { style: 'text-align: justify' }
                : {},
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setTextAlign: (alignment: TextAlignment) =>
        updateParagraphAlignment(alignment),
      unsetTextAlign: () => updateParagraphAlignment(null),
    }
  },
})
