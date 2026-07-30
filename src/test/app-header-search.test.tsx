import { cleanup, render, screen } from '@testing-library/react'
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

describe('AppShell header', () => {
  it('opens the global search panel from the search button', async () => {
    const user = userEvent.setup()
    render(<AppShell />)

    await user.click(
      screen.getByRole('button', { name: /Search all documents/ }),
    )

    expect(await screen.findByLabelText('Search query')).toBeTruthy()
  })
})
