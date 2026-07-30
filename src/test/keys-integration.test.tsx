import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetDatabase } from './dbHarness'

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

afterEach(async () => {
  cleanup()
  await resetDatabase()
})

/**
 * The keyboard, end to end through the real shell.
 *
 * The unit tests prove each piece; this proves they are wired to each other —
 * that a chord in the catalog reaches a command that changes what is on screen.
 */

async function open() {
  const user = userEvent.setup()
  render(<AppShell />)
  // The editor mounts asynchronously; nothing is bound until it does.
  await screen.findByRole('toolbar', { name: 'Formatting' })
  return user
}

/** Focus the document surface, the way it is on almost every keystroke. */
function focusEditor() {
  const surface = document.querySelector('.ProseMirror') as HTMLElement
  surface?.focus()
  return surface
}

describe('shortcuts in the running app', () => {
  it('opens the command palette on its chord', async () => {
    const user = await open()
    focusEditor()

    await user.keyboard('{Meta>}k{/Meta}')

    expect(await screen.findByLabelText('Command palette')).toBeTruthy()
  })

  it('opens the cheat sheet on its chord', async () => {
    const user = await open()
    focusEditor()

    await user.keyboard('{Meta>}/{/Meta}')

    expect(
      await screen.findByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeTruthy()
  })

  it('leaves a bare ? alone while the reader is typing', async () => {
    // The whole reason the focus guard exists: a question mark in the middle
    // of a sentence is a question mark.
    const user = await open()
    focusEditor()

    await user.keyboard('?')

    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
  })

  it('accepts a bare ? from the page, where nothing is being typed', async () => {
    const user = await open()
    ;(
      screen.getByRole('button', { name: /Search all documents/ }) as HTMLElement
    ).focus()

    await user.keyboard('?')

    expect(
      await screen.findByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeTruthy()
  })

  it('opens cross-document search on its chord', async () => {
    const user = await open()
    focusEditor()

    await user.keyboard('{Meta>}{Shift>}f{/Shift}{/Meta}')

    expect(await screen.findByLabelText('Search query')).toBeTruthy()
  })

  it('toggles the comment rail', async () => {
    const user = await open()
    focusEditor()
    const railed = () => screen.queryByRole('complementary', { name: 'Comments' })
    const before = Boolean(railed())

    await user.keyboard('{Meta>}\\{/Meta}')

    await waitFor(() => expect(Boolean(railed())).toBe(!before))
  })

  it('saves a version on ⌘S and says so quietly', async () => {
    // Without this binding the browser's own "Save page as" dialog answers.
    const user = await open()
    focusEditor()

    await user.keyboard('{Meta>}s{/Meta}')

    expect(await screen.findByText('Version saved')).toBeTruthy()
    expect(screen.getByText('Version saved').closest('[role]')?.getAttribute('role'))
      .toBe('status')
  })

  it('stands down while an overlay owns the keyboard', async () => {
    const user = await open()
    focusEditor()

    await user.keyboard('{Meta>}k{/Meta}')
    await screen.findByLabelText('Command palette')

    // ⌘F behind an open palette would put a find bar under a dialog.
    await user.keyboard('{Meta>}f{/Meta}')

    expect(screen.queryByLabelText('Find in document')).toBeNull()
  })

  it('applies a formatting chord the toolbar now advertises', async () => {
    /*
     * Control, not Meta, and the difference is real rather than a test detail.
     * The window matcher treats the two as one `mod`, but ProseMirror resolves
     * `Mod-` per platform — Meta on Apple, Ctrl everywhere else — and this
     * environment reports as neither Apple nor a Mac. Which is also why the
     * toolbar renders "Heading 1 (Alt+1)" here rather than the ⌘⌥1 spelling.
     */
    await open()
    const surface = focusEditor()

    // Read off the toolbar rather than the document: typing into a
    // contenteditable needs the real `beforeinput` events a browser sends and
    // this environment does not, but a mark toggled onto a collapsed cursor
    // becomes a stored mark, which is exactly what `aria-pressed` reports.
    const strike = screen.getByRole('button', { name: 'Strikethrough' })
    expect(strike.getAttribute('aria-pressed')).toBe('false')

    /*
     * Dispatched at the surface rather than typed: an editor-dispatched chord
     * reaches ProseMirror through its own DOM listener, so routing it by focus
     * would be testing whether happy-dom focuses a contenteditable.
     *
     * `keyCode` is not decoration. Shift makes `event.key` the capital 'X',
     * which does not match the lower-case 'x' the binding registers, and
     * prosemirror-keymap recovers by looking the physical key up in its
     * `base[keyCode]` table. A real browser always sends it; leaving it off
     * here would fail for a reason no user could ever hit.
     */
    act(() => {
      surface.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'X',
          code: 'KeyX',
          keyCode: 88,
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })

    await waitFor(() => expect(strike.getAttribute('aria-pressed')).toBe('true'))
  })

  it('prints every tooltip in the catalog’s spelling for this keyboard', async () => {
    // The three sources of truth collapsing into one, visible from outside:
    // these chords are Tiptap's and were advertised nowhere before.
    await open()

    expect(
      screen.getByRole('button', { name: 'Bold' }).getAttribute('title'),
    ).toBe('Bold (Ctrl+B)')
    expect(
      screen.getByRole('button', { name: 'Heading 1' }).getAttribute('title'),
    ).toBe('Heading 1 (Alt+1)')
    expect(
      screen.getByRole('button', { name: 'Bullet list' }).getAttribute('title'),
    ).toBe('Bullet list (Ctrl+Shift+8)')
  })
})
