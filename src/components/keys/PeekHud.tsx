import { useMemo } from 'react'
import type { HeldModifiers } from '../../keys/chord'
import { parseChord, usesExactly } from '../../keys/chord'
import type { Command } from '../../keys/context'
import { chordOf } from '../../keys/registry'
import { formatShortcut, isApplePlatform } from '../../lib/shortcuts'

interface PeekHudProps {
  /** The modifiers held long enough to be asking, or `null`. */
  held: HeldModifiers | null
  /** The commands that apply right now. */
  commands: readonly Command[]
}

/** Past this the panel is a wall of text rather than an answer. */
const MAX_ROWS = 18

/**
 * What this modifier does, while you are still holding it.
 *
 * A view of the keymap, never a second dispatcher: it lists only the chords
 * whose modifier set is *exactly* the one held, and the window matcher matches
 * exactly those modifiers — so pressing the key runs the command through the
 * ordinary path, with nothing here involved. That is also why chords Tiptap
 * delivers work from it without this component knowing they are different.
 *
 * Consequently it never takes focus and never takes a click: the caret stays
 * in the document, blinking, and `aria-hidden` keeps a duplicate reading of
 * commands out of the screen reader, which reaches all of them through the
 * palette and the cheat sheet instead.
 */
export function PeekHud({ held, commands }: PeekHudProps) {
  const apple = isApplePlatform()

  const rows = useMemo(() => {
    if (!held) return []

    return commands
      .map(command => {
        const spec = chordOf(command, apple)
        if (!spec) return null
        const chord = parseChord(spec)
        if (!usesExactly(chord, held)) return null
        return {
          id: command.id,
          label: command.label,
          // The key alone — the modifiers are in the panel's own heading, and
          // repeating "⌘" down eighteen rows is noise.
          key: formatShortcut(spec.split('+').pop() ?? '', apple),
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
  }, [held, commands, apple])

  if (!held || rows.length === 0) return null

  const heldLabel = formatShortcut(
    [
      ...(held.mod ? ['mod'] : []),
      ...(held.alt ? ['alt'] : []),
      ...(held.shift ? ['shift'] : []),
      // `formatShortcut` wants a key to print; an empty tail leaves just the
      // modifier glyphs, which is exactly the heading wanted here.
      '',
    ].join('+'),
    apple,
  )

  const shown = rows.slice(0, MAX_ROWS)

  return (
    <div className="peek" aria-hidden="true">
      <div className="peek__held">{heldLabel}</div>

      <div className="peek__grid">
        {shown.map(row => (
          <div key={row.id} className="peek__row">
            <kbd className="kbd">{row.key}</kbd>
            <span className="peek__label">{row.label}</span>
          </div>
        ))}
      </div>

      {rows.length > shown.length ? (
        <div className="peek__more">
          and {rows.length - shown.length} more — add ⇧ or ⌥ to narrow
        </div>
      ) : null}
    </div>
  )
}
