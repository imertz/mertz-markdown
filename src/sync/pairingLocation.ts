import { VAULT_ROUTE } from './types'

export interface PendingPairingLocation {
  vaultId: string
  pair: string
  wrap: string
}

function capturePairingLocation(): PendingPairingLocation | null {
  if (typeof window === 'undefined') return null
  const match = VAULT_ROUTE.exec(window.location.pathname)
  if (!match?.[1] || !window.location.hash) return null

  // The fragment carries both secrets. Remove it before React mounts, before
  // any network work, prompts, error reporting, or third-party code can retain
  // the current URL. The in-memory copy is deliberately one-shot.
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const pair = fragment.get('p')
  const wrap = fragment.get('w')
  history.replaceState(history.state, '', window.location.pathname + window.location.search)
  return pair && wrap ? { vaultId: match[1], pair, wrap } : null
}

let pendingPairing = capturePairingLocation()

export function hasPendingPairingLocation(): boolean {
  return pendingPairing !== null
}

export function takePendingPairingLocation(): PendingPairingLocation | null {
  const pairing = pendingPairing
  pendingPairing = null
  return pairing
}
