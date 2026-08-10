/**
 * One chord, parsed once, matched everywhere.
 *
 * Bindings are written as `'+'`-joined specs — `'mod+shift+8'`, `'mod+alt+-'` —
 * the same vocabulary `formatShortcut` prints from, so a chord has exactly one
 * spelling in the codebase and the hint can never disagree with the binding.
 *
 * The interesting part is *which* property of the keystroke a token matches
 * against, because the two available ones disagree on every non-US keyboard:
 *
 *   `event.key`   the character produced — moves with the layout
 *   `event.code`  the physical key pressed — fixed to the keycap position
 *
 * The rule, and it is the whole design: **letters keep their character because
 * that is the mnemonic; digits and punctuation keep their position because that
 * is the mnemonic.** ⌘E means "E for emphasis" and has to live under the E a
 * Dvorak typist sees printed, so it matches `key`. ⌘1 means "the first one" and
 * has to live on the key at the left of the number row, so it matches `code` —
 * on AZERTY that key produces `&` unshifted and would never match `key` at all.
 */

export interface Chord {
  /**
   * `event.key`, lower-cased and unshifted: `'e'`, `'arrowup'`, `'8'`, `'.'`.
   *
   * Always populated, even for code-matched chords, so that a synthetic event
   * carrying no `code` — which is most hand-written test events — still works.
   */
  key: string
  /** `event.code`, for the chords where position beats character. */
  code?: string
  /**
   * Shift is part of the character, not part of the chord.
   *
   * Set for tokens like `?` that no keyboard has a key for — you make one by
   * holding Shift, and *which* key you hold it with moves with the layout. So
   * the character is matched and Shift is not compared at all.
   */
  anyShift?: boolean
  /** ⌘ on macOS, Ctrl everywhere else — the two are never distinguished. */
  mod?: boolean
  alt?: boolean
  shift?: boolean
}

/** The modifiers currently down, in the same vocabulary a `Chord` uses. */
export interface HeldModifiers {
  mod: boolean
  alt: boolean
  shift: boolean
}

/**
 * Punctuation, by the key it sits on rather than the character it makes.
 *
 * Every one of these is shifted or relocated on some common layout: `]` is
 * AltGr+9 on German, `/` is Shift+7, `-` moves on AZERTY. Matching position
 * keeps the binding under the same finger everywhere.
 */
const PUNCTUATION_CODES: Record<string, string> = {
  '.': 'Period',
  ',': 'Comma',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '/': 'Slash',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
}

/** Spec token to the `event.key` the browser actually reports. */
const NAMED_KEYS: Record<string, string> = {
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  enter: 'enter',
  escape: 'escape',
  tab: 'tab',
  space: ' ',
  backspace: 'backspace',
  delete: 'delete',
}

/** Spec token to the name `prosemirror-keymap` normalises against. */
const PROSEMIRROR_KEYS: Record<string, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
}

interface ParsedSpec {
  held: Set<string>
  token: string
}

function splitSpec(spec: string): ParsedSpec {
  const parts = spec.split('+').map(part => part.trim().toLowerCase())
  // `pop`, not `at(-1)`: the key is whatever is left after the modifiers, and
  // `'mod+alt+-'` has to yield `'-'` rather than an empty tail.
  const token = parts.pop() ?? ''
  return { held: new Set(parts), token }
}

/**
 * Whether this token is a character you can only produce by holding Shift.
 *
 * Not a letter, not a digit, and not one of the unshifted punctuation keys —
 * so `?`, `!`, `@`. There is no keycap to point at: `?` is Shift+/ on a US
 * keyboard and Shift+ß on a German one, and position would find neither.
 */
function isShiftedCharacter(token: string): boolean {
  return (
    token.length === 1 &&
    !/[a-z0-9]/.test(token) &&
    !PUNCTUATION_CODES[token] &&
    !NAMED_KEYS[token]
  )
}

/** A spec string to the shape the matcher compares against. */
export function parseChord(spec: string): Chord {
  const { held, token } = splitSpec(spec)

  const chord: Chord = {
    key: NAMED_KEYS[token] ?? token,
    mod: held.has('mod'),
    alt: held.has('alt'),
    shift: held.has('shift'),
  }

  if (isShiftedCharacter(token)) chord.anyShift = true
  else if (/^[0-9]$/.test(token)) chord.code = `Digit${token}`
  else if (PUNCTUATION_CODES[token]) chord.code = PUNCTUATION_CODES[token]

  return chord
}

/** The modifiers this event is carrying, normalised to `mod`/`alt`/`shift`. */
export function heldFrom(event: KeyboardEvent): HeldModifiers {
  return {
    mod: event.metaKey || event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  }
}

/**
 * Whether the chord's modifiers are *exactly* the ones held — no more, no less.
 *
 * Exactness is what keeps ⌘K and ⌘⇧K different commands: a chord matches only
 * when nothing extra is held.
 */
export function usesExactly(chord: Chord, held: HeldModifiers): boolean {
  return (
    Boolean(chord.mod) === held.mod &&
    Boolean(chord.alt) === held.alt &&
    // A shifted character carries its own Shift; comparing it would mean `?`
    // only matched on a layout where `?` needs no Shift.
    (Boolean(chord.anyShift) || Boolean(chord.shift) === held.shift)
  )
}

/**
 * Whether this keystroke is this chord.
 *
 * Guards AltGr before anything else. Windows synthesises Ctrl+Alt whenever
 * AltGr is pressed, so a German typist reaching for `µ` (AltGr+M) produces an
 * event indistinguishable from ⌘⌥M — and would open a comment draft mid-word.
 * No binding in the app wants AltGraph, and none should: it belongs to the
 * layout, not to us.
 */
export function matchesChord(chord: Chord, event: KeyboardEvent): boolean {
  if (
    typeof event.getModifierState === 'function' &&
    event.getModifierState('AltGraph')
  ) {
    return false
  }

  const held = heldFrom(event)
  if (!usesExactly(chord, held)) return false

  // Position *or* character, whichever the reader's fingers found. A chord
  // pinned to a keycap still fires for someone whose layout puts that character
  // elsewhere, and the exact-modifier check above keeps the two from colliding.
  if (chord.code && event.code) {
    return event.code === chord.code || event.key.toLowerCase() === chord.key
  }
  return event.key.toLowerCase() === chord.key
}

/**
 * A stable identity for a chord, for detecting two commands claiming one key.
 *
 * Built from the booleans rather than the spec text, so `'shift+alt+mod+z'` and
 * `'mod+alt+shift+z'` collapse to the same string.
 */
export function chordSignature(chord: Chord): string {
  const held = [
    chord.mod ? 'm' : '',
    chord.alt ? 'a' : '',
    chord.shift && !chord.anyShift ? 's' : '',
  ].join('')
  return `${held}:${chord.code ?? chord.key}`
}

/**
 * The same spec, spelled the way `prosemirror-keymap` wants it.
 *
 * Editor-scoped chords are bound inside ProseMirror rather than on the window,
 * so this is what keeps the catalog authoritative for them too. `normalizeKeyName`
 * splits on `/-(?!$)/` and reorders the modifiers itself, so a trailing `-` key
 * survives and the order emitted here does not matter.
 */
export function toProseMirrorKey(spec: string): string {
  const { held, token } = splitSpec(spec)

  const parts: string[] = []
  if (held.has('mod')) parts.push('Mod')
  if (held.has('alt')) parts.push('Alt')
  if (held.has('shift')) parts.push('Shift')
  parts.push(PROSEMIRROR_KEYS[token] ?? token)

  return parts.join('-')
}
