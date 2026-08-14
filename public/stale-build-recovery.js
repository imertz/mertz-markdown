(() => {
  const reloadKey = 'ymm-stale-build-reload'
  const retryWindowMs = 30_000

  const reloadOnce = () => {
    const lastReload = Number(sessionStorage.getItem(reloadKey))
    if (Number.isFinite(lastReload) && Date.now() - lastReload < retryWindowMs) {
      return
    }

    sessionStorage.setItem(reloadKey, String(Date.now()))
    window.location.reload()
  }

  // Vite emits this event when an old page requests a deleted lazy chunk.
  window.addEventListener('vite:preloadError', event => {
    event.preventDefault()
    reloadOnce()
  })

  // The Vite event cannot run when the stale file is the entry module itself.
  window.addEventListener(
    'error',
    event => {
      const target = event.target
      if (!(target instanceof HTMLScriptElement) || target.type !== 'module') {
        return
      }

      const source = new URL(target.src, window.location.href)
      if (
        source.origin === window.location.origin &&
        source.pathname.startsWith('/assets/')
      ) {
        reloadOnce()
      }
    },
    true,
  )

  window.addEventListener('load', () => {
    window.setTimeout(() => sessionStorage.removeItem(reloadKey), retryWindowMs)
  })
})()
