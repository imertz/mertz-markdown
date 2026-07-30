;(function () {
  try {
    var stored = localStorage.getItem('mertz-md:theme')
    var theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    var storedFont = localStorage.getItem('mertz-md:document-font')
    document.documentElement.dataset.documentFont = storedFont || 'system'
    if (theme === 'dark') {
      document
        .querySelector('meta[name="theme-color"]')
        .setAttribute('content', '#1a1917')
    }
  } catch {
    // Storage can be unavailable in a locked-down browser; CSS defaults win.
  }
})()
