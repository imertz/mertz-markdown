import { VAULT_ROUTE } from './types'

export interface PendingPairingLocation {
  vaultId: string
  pair: string
  wrap: string
}

function readPairingUrl(url: URL): PendingPairingLocation | null {
  const match = VAULT_ROUTE.exec(url.pathname)
  if (!match?.[1] || !url.hash) return null
  const fragment = new URLSearchParams(url.hash.slice(1))
  const pair = fragment.get('p')
  const wrap = fragment.get('w')
  return pair && wrap ? { vaultId: match[1], pair, wrap } : null
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

/**
 * The same link the QR encodes, from parts. Used to mint one on the vault that
 * is inviting, and to hand a captured one back to the user when this browser
 * is not where it can be spent — see pairingNeedsHandoff.
 */
export function formatPairingLink(
  location: PendingPairingLocation,
  origin: string = window.location.origin,
): string {
  const fragment = new URLSearchParams({ p: location.pair, w: location.wrap })
  return `${origin}/v/${location.vaultId}#${fragment}`
}

/**
 * A pairing link typed or pasted in rather than navigated to. Relative and
 * absolute forms both parse; a link minted by another origin keeps that
 * origin's vault id, which is all this needs — the API url comes from this
 * build's own configuration, never from the link.
 */
export function parsePairingLink(raw: string): PendingPairingLocation | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return readPairingUrl(new URL(trimmed, window.location.origin))
  } catch {
    return null
  }
}

/**
 * Whether a pairing link that arrived in THIS browser has to be handed to
 * something else to be spent.
 *
 * iOS is the whole of it. A home-screen web app there is a separate browser as
 * far as storage goes — its own IndexedDB, its own vault config — and iOS has
 * no link capturing: a QR scanned with the camera, or a link tapped anywhere,
 * always opens Safari. So the pairing that the user meant for the installed app
 * lands in a tab that cannot pass it on, and claiming it there would burn it:
 * pairings are one-shot, and the app would have nothing left to claim.
 *
 * Rather than guess whether the app is installed — nothing on iOS will say —
 * this asks the user, and the answer is a tap either way.
 */
export function pairingNeedsHandoff(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; touch points are what separates them.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!ios) return false
  const installed =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // The iOS-only property, and the only reliable signal in older versions.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return !installed
}
