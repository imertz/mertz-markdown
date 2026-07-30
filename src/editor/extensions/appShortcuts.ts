import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { CommandId } from '../../keys/catalog'
import { aliasesFor, chordFor } from '../../keys/catalog'
import { toProseMirrorKey } from '../../keys/chord'
import { isApplePlatform } from '../../lib/shortcuts'

/**
 * The editor-side half of the keyboard system.
 *
 * Two jobs, both about chords Tiptap either does not ship or ships wrongly for
 * a keyboard that is not American.
 *
 * **The bindings.** Most formatting chords already come with Tiptap and are
 * documented in the catalog rather than rebound here. What is left is the three
 * it has no answer for — strikethrough and blockquote on chords that survive a
 * Windows browser, and a horizontal rule, which upstream ships with no shortcut
 * at all — plus the plain-Alt spellings that replace Ctrl+Alt off Apple. Every
 * one is read from the catalog, so this file introduces no new spelling of any
 * chord; it only says which command the spelling runs.
 *
 * **The AltGr correction.** Windows reports AltGr as Ctrl+Alt, and Tiptap binds
 * `Mod-Alt-<n>` for headings and `Mod-Alt-c` for code blocks. So on a German
 * keyboard AltGr+2 — how you type the ² in "10 m²" — silently converts the
 * paragraph to a heading, and on Polish AltGr+C does it for `ć`. The window
 * matcher guards this itself (`matchesChord`), but ProseMirror's keymap has no
 * such notion, so the guard has to be installed here as well.
 */

/** The commands this extension binds, and how each is run. */
const EDITOR_COMMANDS = {
  'format.strike': (editor: Editor) =>
    editor.chain().focus().toggleStrike().run(),
  'format.blockquote': (editor: Editor) =>
    editor.chain().focus().toggleBlockquote().run(),
  'format.codeBlock': (editor: Editor) =>
    editor.chain().focus().toggleCodeBlock().run(),
  'format.h1': (editor: Editor) =>
    editor.chain().focus().toggleHeading({ level: 1 }).run(),
  'format.h2': (editor: Editor) =>
    editor.chain().focus().toggleHeading({ level: 2 }).run(),
  'format.h3': (editor: Editor) =>
    editor.chain().focus().toggleHeading({ level: 3 }).run(),
  'format.paragraph': (editor: Editor) =>
    editor.chain().focus().setParagraph().run(),
  'insert.rule': (editor: Editor) =>
    editor.chain().focus().setHorizontalRule().run(),
} satisfies Partial<Record<CommandId, (editor: Editor) => boolean>>

export const AppShortcuts = Extension.create({
  name: 'appShortcuts',

  /*
   * Above Tiptap's own extensions, which sit at the default 100. Both halves
   * need it: the AltGr correction has to be consulted before the heading
   * keymap it is protecting against, and the bindings have to win ties.
   */
  priority: 1000,

  addKeyboardShortcuts() {
    /*
     * Resolved for the keyboard actually in front of the reader. This is the
     * line that keeps ⌥1 typing `¡` on a Mac while Alt+1 sets a heading on
     * Windows: the plain-Alt spellings only exist off Apple hardware, because
     * that is the only place Ctrl+Alt is unusable.
     */
    const apple = isApplePlatform()
    const bindings: Record<string, () => boolean> = {}

    for (const [id, run] of Object.entries(EDITOR_COMMANDS)) {
      const specs = [
        chordFor(id as CommandId, apple),
        ...aliasesFor(id as CommandId, apple),
      ]
      for (const spec of specs) {
        if (!spec) continue
        bindings[toProseMirrorKey(spec)] = () => run(this.editor)
      }
    }

    return bindings
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('altGraphPassthrough'),
        props: {
          handleKeyDown(view, event) {
            if (
              typeof event.getModifierState !== 'function' ||
              !event.getModifierState('AltGraph')
            ) {
              return false
            }

            // A single-character `key` is the whole point: AltGr is only ever
            // held to produce a character, and anything else — a dead key
            // reported as 'Dead', an arrow — is left for the keymaps, none of
            // which bind Ctrl+Alt to a non-character.
            if (event.key.length !== 1) return false

            /*
             * Do the browser's job rather than merely blocking the keymaps.
             * Claiming the key means ProseMirror calls preventDefault, so the
             * character would otherwise be lost — and there is no way to say
             * "skip the remaining handlers but keep the default".
             */
            view.dispatch(view.state.tr.insertText(event.key).scrollIntoView())
            return true
          },
        },
      }),
    ]
  },
})
