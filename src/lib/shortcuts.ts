/**
 * Keyboard hints, spelled the way the reader's own keyboard is labelled.
 *
 * Every binding in the app is registered with `mod` — ⌘ on Apple hardware, Ctrl
 * everywhere else, see `useGlobalShortcuts` — so a hint hardcoded as "⌘K" is
 * wrong for most of the people who read it. Hints are written in the same
 * vocabulary the bindings use and printed per platform: Apple's unseparated
 * glyph run against the plus-joined words Windows and Linux label their keys
 * with.
 */

const MODIFIERS = {
  apple: { mod: '⌘', alt: '⌥', shift: '⇧' },
  other: { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' },
} as const

/** Modifiers always print in this order, whatever order the spec names them. */
const MODIFIER_ORDER = ['mod', 'alt', 'shift'] as const

type Modifier = (typeof MODIFIER_ORDER)[number]

/**
 * Keys whose printed name is not just the spec token upper-cased.
 *
 * Arrows are glyphs everywhere — every keyboard prints them on the keycap — but
 * Return is ⏎ only on Apple's, so it splits.
 */
const KEYS = {
  apple: {
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    enter: '⏎',
    tab: '⇥',
    escape: '⎋',
    space: 'Space',
    backspace: '⌫',
    delete: '⌦',
  },
  other: {
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    enter: 'Enter',
    tab: 'Tab',
    escape: 'Esc',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Delete',
  },
} as const

/**
 * Whether to print Apple's glyphs.
 *
 * `userAgentData.platform` where it exists, then the deprecated
 * `navigator.platform`, then the user-agent string — the last two are the only
 * option in Safari and Firefox, which do not ship the modern API.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const modern = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform
  return /mac|iphone|ipad|ipod/i.test(
    modern || navigator.platform || navigator.userAgent,
  )
}

/**
 * A hint string from a `+`-separated spec: `'mod+alt+shift+up'`, `'mod+enter'`.
 *
 * The platform is a parameter with a detected default so tests can print both
 * spellings without touching the environment.
 */
export function formatShortcut(
  spec: string,
  apple: boolean = isApplePlatform(),
): string {
  const tokens = spec.split('+').map(token => token.trim().toLowerCase())
  const key = tokens.pop() ?? ''
  const held = new Set(tokens)

  const modifiers = apple ? MODIFIERS.apple : MODIFIERS.other
  const keys: Record<string, string> = apple ? KEYS.apple : KEYS.other

  const parts: string[] = MODIFIER_ORDER.filter((name: Modifier) =>
    held.has(name),
  ).map((name: Modifier) => modifiers[name])
  parts.push(keys[key] ?? key.toUpperCase())

  return apple ? parts.join('') : parts.join('+')
}
