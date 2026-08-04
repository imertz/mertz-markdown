import {
  useHeadingStations,
  useReadingPosition,
} from '../hooks/useReadingPosition'

interface ReadingScaleProps {
  /** How many headings the document has — the stations' change signal. */
  outlineLength: number
  /** Index into the outline of the section the caret is in; -1 above the first. */
  activeIndex: number
}

/**
 * The dial along the top edge of the status bar: fine graduations with every
 * fifth one taller, a station mark for each heading, and a needle riding the
 * reading position.
 *
 * The stations are what stop it being a ruler. A ruler is the same on every
 * document; this is a map of the one you are in, and the needle passing a
 * station means that heading has just reached the top of the screen.
 *
 * Absent, not empty, while the document fits on screen — a scale reading
 * nothing is the kind of detail that makes an instrument look decorative.
 *
 * aria-hidden because it says nothing the readout beside it does not already
 * say in words, and the outline menu already exposes the headings navigably.
 */
export function ReadingScale({
  outlineLength,
  activeIndex,
}: ReadingScaleProps) {
  const { top, extent, scrollable } = useReadingPosition()
  const stations = useHeadingStations(outlineLength)

  if (!scrollable) return null

  return (
    <div className="reading-scale" aria-hidden="true">
      {/*
        Only the top two levels. Every heading is measured so the indices stay
        aligned with the outline, but a document with forty H3s would draw a
        comb rather than a dial, and a station that marks everything marks
        nothing.
      */}
      {stations
        .filter(station => station.level <= 2)
        .map(station => (
          <span
            key={station.index}
            className="reading-scale__station"
            data-level={station.level}
            data-active={station.index === activeIndex || undefined}
            /* Inset by the station's own width so one at the very end of the
               document is drawn whole rather than clipped to a sliver. */
            style={{ left: `calc(${station.at} * (100% - 2px))` }}
          />
        ))}

      {/*
        The viewport, as the span of the document it actually covers rather
        than as a point. Inline style for the geometry, the same way the
        popovers carry their coordinates.

        Drawn last so it sits over the stations: a station showing through the
        band is a section you can see on screen right now, which is the whole
        reason the band has an extent.
      */}
      <span
        className="reading-scale__view"
        style={{ left: `${top * 100}%`, width: `${extent * 100}%` }}
      />
    </div>
  )
}
