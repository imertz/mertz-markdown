import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultMenu } from '../components/sync/VaultMenu'
import type { VaultSyncApi } from '../hooks/useVaultSync'

afterEach(cleanup)

function syncApi(overrides: Partial<VaultSyncApi> = {}): VaultSyncApi {
  return {
    status: 'disabled',
    error: null,
    enabled: false,
    config: null,
    devices: [],
    pendingPairing: false,
    syncNow: vi.fn(),
    enable: vi.fn(),
    createPairingLink: vi.fn(),
    claimPairingFromLocation: vi.fn(),
    loadDevices: vi.fn(),
    revokeDevice: vi.fn(),
    disableOnDevice: vi.fn(),
    ...overrides,
  }
}

describe('anonymous vault onboarding', () => {
  it('explains the allowance and creates without asking for a credential', async () => {
    const sync = syncApi()
    const user = userEvent.setup()
    render(<VaultMenu sync={sync} />)

    await user.click(screen.getByRole('button', { name: 'Sync' }))
    expect(screen.getByText('500 MiB')).not.toBeNull()
    expect(screen.getByText('Anonymous')).not.toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()

    const create = screen.getByRole('button', {
      name: 'Create encrypted vault',
    }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    await user.click(screen.getByRole('checkbox'))
    await user.click(create)
    expect(sync.enable).toHaveBeenCalledWith()
  })

  it('shows a registration policy error in the panel', async () => {
    const sync = syncApi({
      enable: vi.fn().mockRejectedValue(new Error('This network has reached its daily vault limit')),
    })
    const user = userEvent.setup()
    render(<VaultMenu sync={sync} />)

    await user.click(screen.getByRole('button', { name: 'Sync' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Create encrypted vault' }))
    expect(await screen.findByText('This network has reached its daily vault limit')).not.toBeNull()
  })
})
