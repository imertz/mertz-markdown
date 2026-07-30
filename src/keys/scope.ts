import type { Chord } from './chord'

/**
 * Where a keystroke landed, and therefore what is allowed to claim it.
 *
 * Without this the window matcher fires everywhere: ⌘F while the palette's own
 * input is focused opens the find bar behind it, and no unmodified key can ever
 * be bound because it would swallow that character out of whatever the reader
 * is typing. Four scopes are enough to state the whole rule.
 */
export type KeyScope = 'app' | 'editor' | 'field' | 'overlay'

/** Elements that take typed characters and are not the document surface. */
const FIELD_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/**
 * Realm-safe element test.
 *
 * `instanceof Element` is false across realms, and the target of a key event is
 * sometimes the document rather than a node, so duck-type on the one method
 * this module needs.
 */
function asElement(value: EventTarget | null): Element | null {
  return value && typeof (value as Element).closest === 'function'
    ? (value as Element)
    : null
}

/**
 * Classify a keystroke by what had focus when it arrived.
 *
 * Overlays are found by an explicit `data-keys="overlay"` attribute rather than
 * a list of class names or `[role=dialog]`. A CSS rename or a panel that is not
 * technically a dialog — the find bar, the comment composer — would silently
 * lose its guard otherwise, and the failure would be a key firing behind an open
 * panel, which nobody would think to test for.
 */
export function scopeOf(event: KeyboardEvent): KeyScope {
  const target =
    asElement(event.target) ?? asElement(document.activeElement) ?? null
  if (!target) return 'app'

  if (target.closest('[data-keys~="overlay"]')) return 'overlay'

  const field = target.closest(FIELD_SELECTOR)
  if (!field) return 'app'

  // The editor surface is itself a contenteditable, so it matches the selector
  // above and this is what separates it from an ordinary text field.
  return field.closest('.ProseMirror') ? 'editor' : 'field'
}

/**
 * Whether a chord is allowed to fire in this scope.
 *
 * Derived from the chord's own modifiers rather than declared per command, so
 * there is nothing to forget to set. The one interesting line is the last:
 * inside the editor a chord must carry ⌘ or ⌥ to be a command at all, which is
 * what makes `?` open the cheat sheet from the page but type a question mark
 * mid-sentence — no predicate, no special case, just the shape of the chord.
 *
 * Deliberate consequence: ⌘F pressed while the find bar's own input is focused
 * no longer re-selects the query. An overlay that owns the screen owns its keys,
 * and the alternative is a per-command escape hatch that would be used once.
 */
export function firesIn(chord: Chord, scope: KeyScope): boolean {
  if (scope === 'overlay' || scope === 'field') return false
  if (scope === 'app') return true
  return Boolean(chord.mod || chord.alt)
}
