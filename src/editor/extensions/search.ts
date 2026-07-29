import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface SearchMatch {
  from: number
  to: number
}

export interface SearchState {
  query: string
  matches: SearchMatch[]
  /** Index into `matches`; -1 exactly when there are none. */
  activeIndex: number
}

const EMPTY: SearchState = { query: '', matches: [], activeIndex: -1 }

export const searchKey = new PluginKey<SearchState>('search')

type SearchMeta =
  | { type: 'set'; state: SearchState }
  | { type: 'goto'; index: number }

/**
 * Every occurrence of `query`, case-insensitively, in document order.
 *
 * Scans per text*block* rather than per text node: applying a mark splits a
 * text node, so a phrase like "three four" can span two nodes that no
 * per-node `indexOf` would ever join up. `textBetween`'s leaf placeholder is
 * one character wide — the same width as the node it stands in for — which is
 * what keeps an index into the string a valid offset into the block.
 */
export function findMatches(doc: PMNode, query: string): SearchMatch[] {
  const matches: SearchMatch[] = []
  const needle = query.toLowerCase()
  if (!needle) return matches

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true

    const text = node
      .textBetween(0, node.content.size, undefined, '\n')
      .toLowerCase()

    let index = text.indexOf(needle)
    while (index !== -1) {
      const from = pos + 1 + index
      matches.push({ from, to: from + needle.length })
      // Non-overlapping, which is what every other find box does: searching
      // "aa" in "aaaa" finds two, not three.
      index = text.indexOf(needle, index + needle.length)
    }

    // A textblock holds inline content only; there is nothing below to visit.
    return false
  })

  return matches
}

/**
 * Put the caret on a match.
 *
 * The active match *is* the selection, so closing the bar leaves the caret
 * where the user was looking and they can simply start typing. No steps are
 * added, so this never lands on the undo stack.
 */
const select = (tr: Transaction, match: SearchMatch): Transaction =>
  tr
    .setSelection(TextSelection.create(tr.doc, match.from, match.to))
    .scrollIntoView()

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    search: {
      /** Replace the query and jump to its first hit. `''` clears the bar. */
      setSearchQuery: (query: string) => ReturnType
      /** Move to the next/previous hit, wrapping at either end. */
      stepSearchMatch: (delta: 1 | -1) => ReturnType
      replaceSearchMatch: (replacement: string) => ReturnType
      replaceAllSearchMatches: (replacement: string) => ReturnType
    }
  }
}

/**
 * Find and replace, as decorations only.
 *
 * Nothing here writes to the document until the user actually replaces, so
 * searching cannot pollute the undo stack — Cmd-Z after a search still undoes
 * the last *edit*. Adds no node and no mark, so the schema is untouched.
 */
export const Search = Extension.create({
  name: 'search',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,

        state: {
          init: () => EMPTY,

          apply(tr, value, _previous, next) {
            const meta = tr.getMeta(searchKey) as SearchMeta | undefined

            if (meta?.type === 'set') return meta.state
            if (meta?.type === 'goto') {
              return { ...value, activeIndex: meta.index }
            }

            if (!tr.docChanged || !value.query) return value

            // Typing under an open find bar must not leave highlights sitting
            // on text that has since moved or gone.
            const matches = findMatches(next.doc, value.query)
            return {
              ...value,
              matches,
              activeIndex: matches.length
                ? Math.min(Math.max(value.activeIndex, 0), matches.length - 1)
                : -1,
            }
          },
        },

        props: {
          decorations(state) {
            const value = searchKey.getState(state)
            if (!value?.matches.length) return DecorationSet.empty

            return DecorationSet.create(
              state.doc,
              value.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class:
                    index === value.activeIndex
                      ? 'search-match search-match--active'
                      : 'search-match',
                }),
              ),
            )
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      setSearchQuery:
        (query: string) =>
        ({ state, tr, dispatch }) => {
          // Computed here rather than in `apply` so the command knows where the
          // first hit is and can move the caret in the same transaction.
          const matches = findMatches(state.doc, query)
          if (dispatch) {
            tr.setMeta(searchKey, {
              type: 'set',
              state: {
                query,
                matches,
                activeIndex: matches.length ? 0 : -1,
              },
            })
            const first = matches[0]
            if (first) select(tr, first)
            dispatch(tr)
          }
          return true
        },

      stepSearchMatch:
        (delta: 1 | -1) =>
        ({ state, tr, dispatch }) => {
          const value = searchKey.getState(state)
          if (!value?.matches.length) return false

          const count = value.matches.length
          // Wraps rather than clamping: with one hit in the document the answer
          // is always that hit, so Enter never goes dead.
          const index = (value.activeIndex + delta + count) % count
          if (dispatch) {
            tr.setMeta(searchKey, { type: 'goto', index })
            select(tr, value.matches[index])
            dispatch(tr)
          }
          return true
        },

      replaceSearchMatch:
        (replacement: string) =>
        ({ state, tr, dispatch }) => {
          const value = searchKey.getState(state)
          const match = value?.matches[value.activeIndex]
          if (!match) return false

          if (dispatch) {
            // insertText carries the marks spanning the range across, so
            // replacing a word inside a comment anchor keeps its thread.
            tr.insertText(replacement, match.from, match.to)
            dispatch(tr)
          }
          return true
        },

      replaceAllSearchMatches:
        (replacement: string) =>
        ({ state, tr, dispatch }) => {
          const value = searchKey.getState(state)
          if (!value?.matches.length) return false

          if (dispatch) {
            // One transaction, so the whole replace-all undoes in one press.
            // Each position is mapped through the steps already queued on `tr`.
            for (const match of value.matches) {
              tr.insertText(
                replacement,
                tr.mapping.map(match.from),
                tr.mapping.map(match.to),
              )
            }
            dispatch(tr)
          }
          return true
        },
    }
  },
})

export function getSearchState(editor: Editor): SearchState {
  if (editor.isDestroyed) return EMPTY
  return searchKey.getState(editor.state) ?? EMPTY
}

/** Drop the query and every highlight with it. */
export function clearSearch(editor: Editor): void {
  if (editor.isDestroyed) return
  editor.view.dispatch(
    editor.state.tr.setMeta(searchKey, { type: 'set', state: EMPTY }),
  )
}
