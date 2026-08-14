import { useEffect, useState } from 'react'

/**
 * Subscribe to a media query from JS.
 *
 * Almost every responsive decision in this app is made in CSS, and should stay
 * there. This is for the few that cannot be: where the phone and the desktop
 * want genuinely different components rather than the same component styled
 * differently, and rendering both to hide one would mean two copies of the same
 * open/closed state.
 *
 * The subscription shape matches the `prefers-color-scheme` listener in
 * useTheme.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(query)
    // The query can change between renders, so re-read rather than trusting the
    // state seeded by the previous one.
    setMatches(media.matches)

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    media.addEventListener('change', onChange)
    return () => {
      media.removeEventListener('change', onChange)
    }
  }, [query])

  return matches
}
