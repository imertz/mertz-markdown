import type { AnyExtension } from '@tiptap/core'

/**
 * Schema contributions from statically bundled application extensions.
 *
 * These are installed even while their application UI is disabled so a
 * document containing their node metadata can always be opened losslessly.
 * The Blog Publisher deliberately contributes none: it only extends existing
 * image attributes and owns publishing state above Tiptap.
 */
export const registeredEditorExtensions: readonly AnyExtension[] = []
