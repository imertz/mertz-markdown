import { useEffect, useState } from 'react'

/**
 * Connectivity, for the status bar's offline chip.
 *
 * `navigator.onLine` is a weak signal — it reports a live network interface,
 * not a reachable internet — but that is exactly the right granularity here.
 * Everything in this app is local-first, so the chip's job is reassurance
 * ("still saving"), not diagnosis.
 */
export function useOnline(): boolean {
  // `!== false` rather than a bare read: a test environment without the
  // property should look online, not permanently offline.
  const [online, setOnline] = useState(() => navigator.onLine !== false)

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine !== false)

    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    // The connection may have dropped between first render and this effect.
    sync()

    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  return online
}
