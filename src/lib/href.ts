/**
 * Schemes that execute rather than navigate. A link mark carrying one of these
 * is a script the document runs on click, so the popover refuses to write it.
 */
const UNSAFE = /^(?:javascript|data|vbscript|file):/i

/** Anything with a scheme of its own — `mailto:`, `tel:`, `https:`. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

const BARE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Turn what someone typed into an href, or `''` if it cannot safely be one.
 *
 * Typing `example.com` and getting a link to a *relative path* named
 * "example.com" is the failure mode this exists to prevent — so a bare host
 * gains `https://`, while anything that already knows what it is (a scheme, a
 * site-root path, an in-page fragment) is left exactly as written.
 */
export function normalizeHref(raw: string): string {
  const value = raw.trim()
  if (!value || UNSAFE.test(value)) return ''

  if (HAS_SCHEME.test(value)) return value
  if (value.startsWith('/') || value.startsWith('#') || value.startsWith('?')) {
    return value
  }
  if (BARE_EMAIL.test(value)) return `mailto:${value}`

  return `https://${value}`
}
