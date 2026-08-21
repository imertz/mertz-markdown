import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultMenu } from '../components/sync/VaultMenu'
import type { VaultSyncApi } from '../hooks/useVaultSync'

afterEach(cleanup)

/** Replaces whatever clipboard is in place — user-event installs one of its own
    in setup(), so this has to run after it. */
function stubClipboard(readText: () => Promise<string>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { readText },
    configurable: true,
  })
}

function syncApi(overrides: Partial<VaultSyncApi> = {}): VaultSyncApi {
  return {
    status: 'disabled',
    error: null,
    enabled: false,
    config: null,
    devices: [],
    usage: null,
    pendingPairing: false,
    hasPendingPairingClaim: false,
    syncNow: vi.fn(),
    enable: vi.fn(),
    createPairingLink: vi.fn(),
    claimPairingFromLocation: vi.fn(),
    claimPairingLink: vi.fn(),
    takePairingHandoffLink: vi.fn(),
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
    // No credential is asked for. The one text field in this state is the
    // pairing link for joining an existing vault, which is not one.
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.getAllByRole('textbox').map(field => field.getAttribute('aria-label'))).toEqual([
      'Pairing link',
    ])

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

describe('joining a vault from a pasted link', () => {
  it('claims the link and reports the pairing', async () => {
    const sync = syncApi({ claimPairingLink: vi.fn().mockResolvedValue(true) })
    const user = userEvent.setup()
    render(<VaultMenu sync={sync} />)

    await user.click(screen.getByRole('button', { name: 'Sync' }))
    const field = screen.getByLabelText('Pairing link')
    const join = screen.getByRole('button', { name: 'Join vault' }) as HTMLButtonElement
    expect(join.disabled).toBe(true)

    await user.type(field, 'https://example.test/v/abcdefghijklmnop#p=a.b&w=c')
    await user.click(screen.getByRole('button', { name: 'Join vault' }))

    expect(sync.claimPairingLink).toHaveBeenCalledWith(
      'https://example.test/v/abcdefghijklmnop#p=a.b&w=c',
    )
    expect(await screen.findByText('Paired. The vault is syncing to this browser.')).not.toBeNull()
  })

  it('surfaces a rejected link in the panel', async () => {
    const sync = syncApi({
      claimPairingLink: vi.fn().mockRejectedValue(new Error('That is not a pairing link')),
    })
    const user = userEvent.setup()
    render(<VaultMenu sync={sync} />)

    await user.click(screen.getByRole('button', { name: 'Sync' }))
    await user.type(screen.getByLabelText('Pairing link'), 'nonsense')
    await user.click(screen.getByRole('button', { name: 'Join vault' }))

    expect(await screen.findByText('That is not a pairing link')).not.toBeNull()
  })

  it('is not offered once this browser already has the vault', async () => {
    const sync = syncApi({
      enabled: true,
      status: 'idle',
      loadDevices: vi.fn().mockResolvedValue(undefined),
    })
    const user = userEvent.setup()
    render(<VaultMenu sync={sync} />)

    await user.click(screen.getByRole('button', { name: 'Sync' }))
    expect(screen.queryByLabelText('Pairing link')).toBeNull()
  })

  it('fills the field from the clipboard, which is the only paste iOS offers reliably', async () => {
    const sync = syncApi({ claimPairingLink: vi.fn().mockResolvedValue(true) })
    const user = userEvent.setup()
    // After setup(), which installs a clipboard stub of its own.
    stubClipboard(vi.fn().mockResolvedValue('  https://example.test/v/abcdefghijklmnop#p=a.b&w=c  '))
    render(<VaultMenu sync={sync} />)

    await user.click(screen.getByRole('button', { name: 'Sync' }))
    await user.click(screen.getByRole('button', { name: 'Paste link' }))

    const field = (await screen.findByLabelText('Pairing link')) as HTMLInputElement
    expect(field.value).toBe('https://example.test/v/abcdefghijklmnop#p=a.b&w=c')

    await user.click(screen.getByRole('button', { name: 'Join vault' }))
    expect(sync.claimPairingLink).toHaveBeenCalledWith(
      'https://example.test/v/abcdefghijklmnop#p=a.b&w=c',
    )
  })

  it('says what to do when the clipboard is refused', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    render(<VaultMenu sync={syncApi()} />)

    await user.click(screen.getByRole('button', { name: 'Sync' }))
    await user.click(screen.getByRole('button', { name: 'Paste link' }))

    expect(
      await screen.findByText('Paste was blocked. Touch and hold the field, then choose Paste.'),
    ).not.toBeNull()
  })
})
