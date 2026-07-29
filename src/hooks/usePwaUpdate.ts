import { useRegisterSW } from 'virtual:pwa-register/react'

export interface PwaUpdateApi {
  /** A new version is waiting to activate. */
  needRefresh: boolean
  /** The app is precached and will start with no network. */
  offlineReady: boolean
  /** Flush pending work, then activate the new version and reload. */
  update: (flush: () => Promise<void>) => Promise<void>
  dismissUpdate: () => void
  dismissOfflineReady: () => void
}

export function usePwaUpdate(): PwaUpdateApi {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('[pwa] service worker registration failed', error)
    },
  })

  return {
    needRefresh,
    offlineReady,
    /**
     * Activating a waiting worker reloads the page. Anything still sitting in
     * the autosave debounce would be lost, so it is committed first — this is
     * the entire reason the app uses registerType 'prompt'.
     */
    update: async (flush: () => Promise<void>) => {
      await flush()
      await updateServiceWorker(true)
    },
    dismissUpdate: () => setNeedRefresh(false),
    dismissOfflineReady: () => setOfflineReady(false),
  }
}
