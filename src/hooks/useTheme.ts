import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const THEME_KEY = 'mertz-md:theme'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function storedTheme(): Theme | null {
  const value = localStorage.getItem(THEME_KEY)
  return value === 'light' || value === 'dark' ? value : null
}

/**
 * Light/dark with an explicit user override.
 *
 * All theming keys off `data-theme` on <html>; the inline boot script in
 * index.html sets it before first paint so there's no flash of the wrong
 * theme. This hook only has to keep it in sync afterwards.
 *
 * Until the user picks a side we follow the OS live. The first toggle writes
 * to localStorage, and from then on the stored choice wins.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => storedTheme() ?? systemTheme(),
  )

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    // Keeps native widgets (scrollbars, form controls, the caret) in step.
    root.style.colorScheme = theme

    // The address bar on mobile reads this; a media-scoped meta would ignore
    // an explicit override, so it's driven from here instead.
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', theme === 'dark' ? '#1a1917' : '#faf9f7')
  }, [theme])

  useEffect(() => {
    // Only track the OS while the user hasn't overridden it.
    if (storedTheme()) return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => {
      if (!storedTheme()) setTheme(event.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', onChange)
    return () => {
      media.removeEventListener('change', onChange)
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme(current => {
      const next = current === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, next)
      return next
    })
  }, [])

  return { theme, toggle }
}
