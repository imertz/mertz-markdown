import type { Editor } from '@tiptap/core'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { putDocument } from '../db/documents'
import { makeDocument, resetDatabase } from './dbHarness'

// The real hook imports a Vite PWA virtual module that only resolves in the
// app build, not under vitest.
vi.mock('../hooks/usePwaUpdate', () => ({
  usePwaUpdate: () => ({
    needRefresh: false,
    offlineReady: false,
    update: async () => {},
    dismissUpdate: () => {},
    dismissOfflineReady: () => {},
  }),
}))

const { AppShell } = await import('../components/AppShell')

/**
 * Starting a comment while the rail is hidden.
 *
 * The composer is a card inside the rail, and hiding the rail unmounts it
 * rather than collapsing it — so a draft begun without it went nowhere at all:
 * no card, no caret, nothing. The click read as broken. Every entry point (both
 * bubble menus and the chord) funnels through the same `startDraft`, so showing
 * the rail there covers all of them.
 */

const SENTENCE = 'The quick brown fox jumps.'

/* Seeded rather than typed: the shell loads the active document asynchronously
   and re-sets the editor's content when it lands, which would wipe a selection
   made before it arrived. Waiting for this text is how a test knows the load
   is done. */
beforeEach(async () => {
  localStorage.clear()
  await resetDatabase()
  await putDocument(
    makeDocument({
      title: 'Field notes',
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: SENTENCE }] },
        ],
      },
      markdown: SENTENCE,
    }),
  )
})

afterEach(async () => {
  cleanup()
  await resetDatabase()
})

/** Tiptap hangs the editor off its own DOM node — the only handle a full-shell
 *  render offers. */
const mountedEditor = (): Editor =>
  (document.querySelector('.ProseMirror') as unknown as { editor: Editor })
    .editor

const rail = () => screen.queryByRole('complementary', { name: 'Comments' })

/** Render, and wait until the seeded document is actually in the editor. */
async function openWithRailHidden() {
  const user = userEvent.setup()
  render(<AppShell />)
  await screen.findByRole('toolbar', { name: 'Formatting' })
  await waitFor(() =>
    expect(mountedEditor().state.doc.textContent).toBe(SENTENCE),
  )

  await user.click(screen.getByRole('button', { name: /Hide comments/ }))
  await waitFor(() => expect(rail()).toBeNull())

  return { user, editor: mountedEditor() }
}

/** Let the shell re-render on the editor transaction before the chord lands. */
const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })

describe('starting a comment with the rail hidden', () => {
  it('brings the rail back and shows the composer', async () => {
    const { user, editor } = await openWithRailHidden()

    act(() => {
      editor.commands.setTextSelection({ from: 5, to: 10 })
    })
    await settle()
    // `alt+m`, not `mod+alt+m`: this environment reports as non-Apple, so the
    // catalog's `keysOther` spelling is the one that binds.
    await user.keyboard('{Alt>}m{/Alt}')

    await waitFor(() => expect(rail()).not.toBeNull())
    expect(await screen.findByLabelText('Add a comment…')).toBeTruthy()
  })

  it('leaves a hidden rail hidden when nothing is selected', async () => {
    // The empty-selection guard runs first, so asking to comment on a bare
    // caret is still a no-op — it must not pop the rail open for a draft that
    // never starts.
    const { user, editor } = await openWithRailHidden()

    act(() => {
      editor.commands.setTextSelection({ from: 5, to: 5 })
    })
    await settle()
    await user.keyboard('{Alt>}m{/Alt}')
    await settle()

    expect(rail()).toBeNull()
    expect(screen.queryByLabelText('Add a comment…')).toBeNull()
  })
})
