import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useState } from 'react'
import type { OutlineEntry } from '../editor/outline'
import { activeHeadingIndex, collectOutline } from '../editor/outline'
import { countWords, readingMinutes } from '../lib/stats'
import { useDebouncedCallback } from './useDebouncedCallback'

export interface DocumentStats {
  /** Words in the whole document. */
  words: number
  /** Words inside the selection, or 0 when the selection is empty. */
  selectedWords: number
  /** Reading time for the whole document, in minutes. */
  minutes: number
  /** Every heading, in document order. */
  outline: OutlineEntry[]
  /** Index into `outline` of the caret's section; -1 above the first heading. */
  activeIndex: number
}

const EMPTY: DocumentStats = {
  words: 0,
  selectedWords: 0,
  minutes: 0,
  outline: [],
  activeIndex: -1,
}

/**
 * Long enough that a full-document walk never lands between two keystrokes,
 * short enough that the readout feels attached to what was just typed.
 */
const MEASURE_DELAY_MS = 300

function read(editor: Editor): DocumentStats {
  const { doc, selection } = editor.state

  // A space for both the block and the leaf separator, so adjacent blocks do
  // not run their last and first words together into one.
  const words = countWords(doc.textBetween(0, doc.content.size, ' ', ' '))
  const { from, to } = selection
  const selectedWords =
    from === to ? 0 : countWords(doc.textBetween(from, to, ' ', ' '))

  const outline = collectOutline(doc)

  return {
    words,
    selectedWords,
    minutes: readingMinutes(words),
    outline,
    activeIndex: activeHeadingIndex(outline, from),
  }
}

const sameOutline = (
  a: readonly OutlineEntry[],
  b: readonly OutlineEntry[],
): boolean =>
  a.length === b.length &&
  a.every(
    (entry, i) =>
      entry.pos === b[i].pos &&
      entry.end === b[i].end &&
      entry.level === b[i].level &&
      entry.text === b[i].text,
  )

// `read` builds a fresh outline array every tick, so identity says nothing —
// without a content comparison the bar re-renders on every debounce.
const same = (a: DocumentStats, b: DocumentStats): boolean =>
  a.words === b.words &&
  a.selectedWords === b.selectedWords &&
  a.minutes === b.minutes &&
  a.activeIndex === b.activeIndex &&
  sameOutline(a.outline, b.outline)

/**
 * Word count, selection count and section heading for the status bar.
 *
 * Recomputed off `update` and `selectionUpdate` through a debounce, because
 * both fire per keystroke and per pointer move during a drag-select while the
 * measurement walks the entire document. `useDebouncedCallback` is trailing-
 * only, so during genuinely uninterrupted typing the readout holds at its last
 * value until a pause — an acceptable trade for not walking the document on
 * every transaction.
 */
export function useDocumentStats(
  editor: Editor | null,
  activeId: string | null,
): DocumentStats {
  const [stats, setStats] = useState<DocumentStats>(EMPTY)

  const measure = useCallback(() => {
    const next = editor && !editor.isDestroyed ? read(editor) : EMPTY
    setStats(previous => (same(previous, next) ? previous : next))
  }, [editor])

  const { schedule, cancel } = useDebouncedCallback(measure, MEASURE_DELAY_MS)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const onChange = () => schedule()
    editor.on('update', onChange)
    editor.on('selectionUpdate', onChange)

    return () => {
      editor.off('update', onChange)
      editor.off('selectionUpdate', onChange)
    }
  }, [editor, schedule])

  // Opening a document calls setContent with `emitUpdate: false`, and nothing
  // fires on mount either, so neither subscription above would ever run for a
  // document the user has not yet touched. Measure directly instead.
  useEffect(() => {
    cancel()
    measure()
  }, [activeId, cancel, measure])

  return stats
}
