import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { collectAnchoredThreadIds } from './comment'

export interface CommentSyncOptions {
  onAnchorsChanged: (threadIds: Set<string>) => void
}

const sameSet = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every(value => b.has(value))

/**
 * Reports which threads still have an anchor, whenever that set changes.
 *
 * Deliberately a *view* plugin rather than `appendTransaction`: the latter runs
 * inside the transaction pipeline, where calling into React state is a
 * re-entrancy hazard. `update` is the sanctioned place for side effects. This
 * only reports — deciding what to do about a missing anchor is the hook's job.
 */
export const CommentSync = Extension.create<CommentSyncOptions>({
  name: 'commentSync',

  addOptions() {
    return { onAnchorsChanged: () => {} }
  },

  addProseMirrorPlugins() {
    const { onAnchorsChanged } = this.options

    return [
      new Plugin({
        key: new PluginKey('commentSync'),

        view(view) {
          let previous = collectAnchoredThreadIds(view.state.doc)
          onAnchorsChanged(previous)

          return {
            update(updatedView, previousState) {
              if (updatedView.state.doc === previousState.doc) return
              const next = collectAnchoredThreadIds(updatedView.state.doc)
              if (sameSet(next, previous)) return
              previous = next
              onAnchorsChanged(next)
            },
          }
        },
      }),
    ]
  },
})
