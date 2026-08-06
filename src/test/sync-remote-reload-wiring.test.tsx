import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/** Every flush that ran, in order, across the whole render. */
const flushes: string[] = []

vi.mock('../hooks/useDebouncedCallback', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../hooks/useDebouncedCallback')>()
  return {
    ...actual,
    useDebouncedCallback: (
      callback: (...args: never[]) => void | Promise<void>,
      delay: number,
    ) => {
      const api = actual.useDebouncedCallback(callback, delay)
      return {
        ...api,
        flush: async () => {
          flushes.push('flush')
          await api.flush()
        },
      }
    },
  }
})

// Captured from AppShell so the test drives the lifecycle the app actually
// passes, rather than a copy of the wiring that could drift away from it.
interface CapturedLifecycle {
  beforeSync?: () => void | Promise<void>
  beforeRemoteBatch?: () => void | Promise<void>
  onRemoteChange?: () => void | Promise<void>
  afterRemoteBatch?: () => void | Promise<void>
}
let lifecycle: CapturedLifecycle | null = null

vi.mock('../hooks/useVaultSync', () => ({
  useVaultSync: (captured: CapturedLifecycle = {}) => {
    lifecycle = captured
    return {
      status: 'disabled' as const,
      error: null,
      enabled: false,
      config: null,
      devices: [],
      usage: null,
      pendingPairing: false,
      hasPendingPairingClaim: false,
      syncNow: async () => {},
      enable: async () => {},
      createPairingLink: async () => '',
      claimPairingFromLocation: async () => false,
      loadDevices: async () => {},
      revokeDevice: async () => {},
      disableOnDevice: async () => {},
    }
  },
}))

const { AppShell } = await import('../components/AppShell')

beforeEach(() => {
  flushes.length = 0
  lifecycle = null
})

afterEach(async () => {
  cleanup()
  await resetDatabase()
})

describe('AppShell vault sync wiring', () => {
  /**
   * The engine calls `beforeRemoteBatch` after it has observed incoming work.
   * AppShell must make the editor read-only and flush before any of that work
   * can replace storage, then restore editability even when reconciliation
   * exits through an error.
   */
  it('flushes behind a read-only remote-apply barrier', async () => {
    render(<AppShell />)
    await waitFor(() => expect(lifecycle?.beforeRemoteBatch).toBeTruthy())
    const editor = await waitFor(() => {
      const element = document.querySelector('[role="textbox"]')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })

    flushes.length = 0
    expect(editor.getAttribute('contenteditable')).toBe('true')

    await lifecycle!.beforeRemoteBatch!()

    expect(flushes).toContain('flush')
    expect(editor.getAttribute('contenteditable')).toBe('false')

    await lifecycle!.onRemoteChange?.()
    await lifecycle!.afterRemoteBatch?.()
    expect(editor.getAttribute('contenteditable')).toBe('true')
  })
})
