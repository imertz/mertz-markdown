import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDB } from '../db/client'
import type { VaultConfigRecord } from '../types'
import { SyncApiClient } from '../sync/api'
import {
  decryptBytes,
  encryptBytes,
  fromBase64Url,
  randomBytes,
  sha256Base64Url,
  toBase64Url,
} from '../sync/crypto'
import { VaultSyncEngine } from '../sync/engine'
import {
  clearVaultConfig,
  getVaultConfig,
  putVaultConfig,
  queueWholeLibrary,
  SYNC_DIRTY_EVENT,
} from '../sync/local'
import {
  DEFAULT_SYNC_API,
  type SyncStatus,
  type VaultDevice,
  type VaultUsage,
} from '../sync/types'
import {
  hasPendingPairingLocation,
  takePendingPairingLocation,
} from '../sync/pairingLocation'

const PAIRING_TTL_MS = 10 * 60 * 1000

function defaultDeviceLabel(): string {
  const platform = navigator.platform || 'Computer'
  const browser = navigator.userAgent.includes('Firefox')
    ? 'Firefox'
    : navigator.userAgent.includes('Edg/')
      ? 'Edge'
      : navigator.userAgent.includes('Chrome/')
        ? 'Chrome'
        : navigator.userAgent.includes('Safari/')
          ? 'Safari'
          : 'Browser'
  return `${browser} on ${platform}`
}

async function prepareLocalLibraryForPairing(): Promise<boolean> {
  const db = await getDB()
  const documents = await db.getAll('documents')
  const only = documents[0]
  const untouched =
    documents.length === 1 &&
    only?.markdown === '' &&
    only.title === 'Untitled' &&
    only.deletedAt === null &&
    (only.doc.content?.length ?? 0) === 1 &&
    only.doc.content?.[0]?.type === 'paragraph' &&
    !only.doc.content?.[0]?.content?.length

  if (untouched) {
    const tx = db.transaction(
      ['documents', 'threads', 'comments', 'snapshots', 'assets', 'syncOutbox'],
      'readwrite',
    )
    await Promise.all([
      tx.objectStore('documents').clear(),
      tx.objectStore('threads').clear(),
      tx.objectStore('comments').clear(),
      tx.objectStore('snapshots').clear(),
      tx.objectStore('assets').clear(),
      tx.objectStore('syncOutbox').clear(),
      tx.done,
    ])
    return true
  }

  if (documents.length === 0) return true
  return window.confirm(
    `This browser has ${documents.length} local document${documents.length === 1 ? '' : 's'}. ` +
      'Add them to the vault while pairing?',
  )
}

export interface VaultSyncApi {
  status: SyncStatus
  error: string | null
  enabled: boolean
  config: VaultConfigRecord | null
  devices: VaultDevice[]
  usage: VaultUsage | null
  pendingPairing: boolean
  hasPendingPairingClaim: boolean
  syncNow: () => Promise<void>
  enable: (apiUrl?: string) => Promise<void>
  createPairingLink: () => Promise<string>
  claimPairingFromLocation: () => Promise<boolean>
  loadDevices: () => Promise<void>
  revokeDevice: (id: string) => Promise<void>
  disableOnDevice: () => Promise<void>
}

export interface VaultSyncLifecycle {
  beforeSync?: () => void | Promise<void>
  beforeRemoteBatch?: () => void | Promise<void>
  onRemoteChange?: () => void | Promise<void>
  afterRemoteBatch?: () => void | Promise<void>
}

export function useVaultSync(lifecycle: VaultSyncLifecycle = {}): VaultSyncApi {
  const [status, setStatus] = useState<SyncStatus>('disabled')
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<VaultConfigRecord | null>(null)
  const [devices, setDevices] = useState<VaultDevice[]>([])
  const [usage, setUsage] = useState<VaultUsage | null>(null)
  const [pendingPairing, setPendingPairing] = useState(false)
  const lifecycleRef = useRef(lifecycle)
  lifecycleRef.current = lifecycle

  const engine = useMemo(
    () =>
      new VaultSyncEngine({
        onStatus: (next, message) => {
          setStatus(next)
          setError(message ?? null)
        },
        onBeforeRemoteBatch: () => lifecycleRef.current.beforeRemoteBatch?.(),
        onRemoteChange: () => lifecycleRef.current.onRemoteChange?.(),
        onAfterRemoteBatch: () => lifecycleRef.current.afterRemoteBatch?.(),
      }),
    [],
  )

  const syncNow = useCallback(async () => {
    await lifecycleRef.current.beforeSync?.()
    await engine.sync()
  }, [engine])

  useEffect(() => {
    void getVaultConfig().then(loaded => {
      setConfig(loaded ?? null)
      setStatus(loaded ? (navigator.onLine ? 'idle' : 'offline') : 'disabled')
      if (loaded) void syncNow().catch(() => undefined)
    })
  }, [syncNow])

  useEffect(() => {
    const run = () => void syncNow().catch(() => undefined)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') run()
    }, 30_000)
    window.addEventListener(SYNC_DIRTY_EVENT, run)
    window.addEventListener('online', run)
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', run)
    return () => {
      clearInterval(timer)
      window.removeEventListener(SYNC_DIRTY_EVENT, run)
      window.removeEventListener('online', run)
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', run)
    }
  }, [syncNow])

  const enable = useCallback(
    async (apiUrl = import.meta.env.VITE_SYNC_API_URL || DEFAULT_SYNC_API) => {
      const key = randomBytes(32)
      const api = new SyncApiClient({ apiUrl })
      const label = defaultDeviceLabel()
      const created = await api.createVault(label)
      const next: VaultConfigRecord = {
        id: 'primary',
        vaultId: created.vaultId,
        masterKey: key.slice().buffer,
        deviceId: created.deviceId,
        deviceToken: created.deviceToken,
        deviceLabel: label,
        apiUrl,
        cursor: 0,
        clockOffsetMs: created.serverTime - Date.now(),
        createdAt: Date.now(),
      }
      await putVaultConfig(next)
      await queueWholeLibrary()
      setConfig(next)
      await syncNow()
    },
    [syncNow],
  )

  const createPairingLink = useCallback(async () => {
    const current = (await getVaultConfig()) ?? config
    if (!current) throw new Error('Enable sync before adding a computer')
    const pairingId = toBase64Url(randomBytes(16))
    const authSecret = randomBytes(32)
    const wrapSecret = randomBytes(32)
    const wrappedKey = await encryptBytes(
      new Uint8Array(current.masterKey),
      wrapSecret,
      current.vaultId,
      'pairing',
      pairingId,
    )
    const api = new SyncApiClient({
      apiUrl: current.apiUrl,
      vaultId: current.vaultId,
      token: current.deviceToken,
    })
    await api.createPairing({
      pairingId,
      tokenHash: await sha256Base64Url(authSecret),
      wrappedKey: toBase64Url(wrappedKey),
      expiresAt: Date.now() + PAIRING_TTL_MS,
    })
    const fragment = new URLSearchParams({
      p: `${pairingId}.${toBase64Url(authSecret)}`,
      w: toBase64Url(wrapSecret),
    })
    return `${window.location.origin}/v/${current.vaultId}#${fragment}`
  }, [config])

  const claimPairingFromLocation = useCallback(async () => {
    const location = takePendingPairingLocation()
    if (!location) return false
    const { vaultId, pair, wrap } = location
    if (await getVaultConfig()) throw new Error('This browser is already paired with a vault')
    const separator = pair.indexOf('.')
    if (separator < 1) throw new Error('Invalid pairing link')
    const pairingId = pair.slice(0, separator)
    const token = pair.slice(separator + 1)
    if (!(await prepareLocalLibraryForPairing())) return false
    setPendingPairing(true)
    try {
      const apiUrl = import.meta.env.VITE_SYNC_API_URL || DEFAULT_SYNC_API
      const api = new SyncApiClient({ apiUrl })
      const label = defaultDeviceLabel()
      const claimed = await api.claimPairing(vaultId, pairingId, token, label)
      const key = await decryptBytes(
        fromBase64Url(claimed.wrappedKey),
        fromBase64Url(wrap),
        vaultId,
        'pairing',
        pairingId,
      )
      const next: VaultConfigRecord = {
        id: 'primary',
        vaultId,
        masterKey: key.slice().buffer,
        deviceId: claimed.deviceId,
        deviceToken: claimed.deviceToken,
        deviceLabel: claimed.deviceLabel,
        apiUrl,
        cursor: 0,
        clockOffsetMs: 0,
        createdAt: Date.now(),
      }
      await putVaultConfig(next)
      await queueWholeLibrary()
      setConfig(next)
      await syncNow()
      return true
    } finally {
      setPendingPairing(false)
    }
  }, [syncNow])

  const loadDevices = useCallback(async () => {
    const current = (await getVaultConfig()) ?? config
    if (!current) return
    const response = await new SyncApiClient({
      apiUrl: current.apiUrl,
      vaultId: current.vaultId,
      token: current.deviceToken,
    }).devices()
    setDevices(response.devices)
    // Older servers predate the usage block; leaving it null keeps the panel on
    // the plain allowance figure rather than showing a 0-byte meter.
    setUsage(response.usage ?? null)
  }, [config])

  const revokeDevice = useCallback(
    async (id: string) => {
      const current = (await getVaultConfig()) ?? config
      if (!current) return
      await new SyncApiClient({
        apiUrl: current.apiUrl,
        vaultId: current.vaultId,
        token: current.deviceToken,
      }).revokeDevice(id)
      await loadDevices()
    },
    [config, loadDevices],
  )

  const disableOnDevice = useCallback(async () => {
    await clearVaultConfig()
    setConfig(null)
    setDevices([])
    setUsage(null)
    setStatus('disabled')
  }, [])

  return {
    status,
    error,
    enabled: config !== null,
    config,
    devices,
    usage,
    pendingPairing,
    hasPendingPairingClaim: hasPendingPairingLocation(),
    syncNow,
    enable,
    createPairingLink,
    claimPairingFromLocation,
    loadDevices,
    revokeDevice,
    disableOnDevice,
  }
}
