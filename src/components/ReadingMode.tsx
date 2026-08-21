import { hintFor } from '../keys/catalog'
import { useReadingPosition } from '../hooks/useReadingPosition'
import { CloseIcon } from './icons'

interface ReadingModeControlsProps {
  onExit: () => void
}

/**
 * The only two things left on screen once the chrome is gone: how far through
 * the document you are, and the way out.
 *
 * Both are fixed rather than in flow. Reading mode leaves the workspace as the
 * whole shell, so anything in the grid would take height off the page it is
 * meant to be getting out of the way of.
 *
 * The progress line is the status bar's reading scale reduced to its one
 * essential reading — see ReadingScale for why the fractions are of the
 * content height rather than of the scroll travel. `top + extent` is where the
 * BOTTOM of the viewport has reached, which is what makes the line full when
 * the last line of the document is on screen rather than when the scroller
 * happens to hit its end.
 */
export function ReadingModeControls({ onExit }: ReadingModeControlsProps) {
  const { top, extent, scrollable } = useReadingPosition()
  /* Escape first: it is the gesture that gets tried, and the chord is worth
     knowing mainly because it is also the way back in. */
  const chord = hintFor('app.toggleReading')
  const label = chord
    ? `Leave reading mode (Esc or ${chord})`
    : 'Leave reading mode (Esc)'

  return (
    <>
      {/* Absent, not empty, on a document that already fits — the same rule
          the scale in the status bar follows. */}
      {scrollable ? (
        <div className="reading-progress" aria-hidden="true">
          <span
            className="reading-progress__fill"
            style={{ width: `${Math.min(1, top + extent) * 100}%` }}
          />
        </div>
      ) : null}

      {/*
        Quiet until it is wanted: the button sits at a low opacity and comes up
        to full ink on hover or focus. It is never hidden outright — a control
        that only exists once you have found it is a trap, and Escape is the
        other way out rather than the only one.
      */}
      <button
        type="button"
        className="reading-exit"
        aria-label={label}
        title={label}
        onClick={onExit}
      >
        <CloseIcon />
      </button>
    </>
  )
}
