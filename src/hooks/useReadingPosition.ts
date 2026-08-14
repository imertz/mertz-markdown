import { useEffect, useState } from 'react'

/** A heading's place on the scale. */
export interface HeadingStation {
  /**
   * Index into the full outline from useDocumentStats, NOT into this array.
   * Every top-level heading is measured so the two stay aligned; the scale
   * then draws only the shallow ones. Keeping the original index is what lets
   * `activeIndex` be compared against a station directly.
   */
  index: number
  level: number
  /** Where it sits along the scale, 0–1. */
  at: number
}

export interface ReadingPosition {
  /** Top of the viewport as a fraction of the whole document, 0–1. */
  top: number
  /** How much of the document is on screen, as a fraction of it, 0–1. */
  extent: number
  /** False when everything already fits on screen and there is nothing to read off. */
  scrollable: boolean
}

const AT_REST: ReadingPosition = { top: 0, extent: 1, scrollable: false }

/*
 * Everything on the scale is a fraction of the CONTENT height, never of the
 * scroll travel.
 *
 * Travel was the obvious choice and it is wrong: a heading in the last
 * screenful of the document divides out above 1 and clamps to the right-hand
 * end, so on a document that only just overflows, most of the stations pile up
 * on top of each other at the edge. Content height puts every station where
 * that heading actually is.
 *
 * That makes the viewport a range rather than a point, so it is drawn as one.
 * A station inside the band is a section currently on screen — which is more
 * than a point could say, and it is the only reading under which the band
 * still reaches the end of the scale when the document is scrolled to the end.
 */
function measure(scroller: Element): ReadingPosition {
  const height = scroller.scrollHeight
  // One pixel of slack absorbs the sub-pixel difference a fractional device
  // pixel ratio leaves behind.
  if (height - scroller.clientHeight <= 1) return AT_REST
  return {
    top: Math.min(1, Math.max(0, scroller.scrollTop / height)),
    extent: Math.min(1, scroller.clientHeight / height),
    scrollable: true,
  }
}

/**
 * Where the viewport sits in the document, for the scale in the status bar.
 *
 * The app scrolls `.workspace`, not the page — see the comment on #root in
 * index.css — so this listens to that element. It is resolved by query rather
 * than by a ref threaded down from AppShell, matching how SlashCommandMenu
 * already finds the same scroller; the status bar is a sibling of the
 * workspace, not a child, so a ref would have to cross the whole shell to get
 * here.
 *
 * Scroll fires far faster than paint, so the read is throttled to one frame,
 * the same shape as useRepositionOnScroll. A ResizeObserver covers the case
 * that motivated `scrollable` in the first place: a document grows past the
 * viewport as you type, and the scale has to appear without a scroll event
 * ever being fired.
 */
export function useReadingPosition(): ReadingPosition {
  const [position, setPosition] = useState<ReadingPosition>(AT_REST)

  useEffect(() => {
    const scroller = document.querySelector('.workspace')
    if (!scroller) return

    let frame = 0
    const sample = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const next = measure(scroller)
        // Re-rendering the status bar on every scroll frame is the one cost
        // this component could impose on typing; bail unless the band would
        // actually move by a visible amount.
        setPosition(current =>
          current.scrollable === next.scrollable &&
          Math.abs(current.top - next.top) < 0.002 &&
          Math.abs(current.extent - next.extent) < 0.002
            ? current
            : next,
        )
      })
    }

    sample()
    scroller.addEventListener('scroll', sample, { passive: true })

    // Fires on the scroller's own box, which changes when the comment rail is
    // toggled or the window resizes. Document growth is caught by the scroll
    // listener's own initial sample plus the observer on the content below.
    const observer = new ResizeObserver(sample)
    observer.observe(scroller)
    const content = scroller.firstElementChild
    if (content) observer.observe(content)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', sample)
      observer.disconnect()
    }
  }, [])

  return position
}

const NO_STATIONS: HeadingStation[] = []

function measureStations(scroller: Element): HeadingStation[] {
  const height = scroller.scrollHeight
  if (height - scroller.clientHeight <= 1) return NO_STATIONS

  const headings = scroller.querySelectorAll<HTMLElement>(
    '.ProseMirror > :is(h1, h2, h3, h4, h5, h6)',
  )
  if (headings.length === 0) return NO_STATIONS

  const top = scroller.getBoundingClientRect().top
  const stations: HeadingStation[] = []

  headings.forEach((heading, index) => {
    const offset =
      heading.getBoundingClientRect().top - top + scroller.scrollTop
    stations.push({
      index,
      level: Number(heading.tagName.slice(1)) || 1,
      // Content height, matching `measure` — see the note there on why travel
      // is the wrong denominator.
      at: Math.min(1, Math.max(0, offset / height)),
    })
  })

  return stations
}

/**
 * Where each heading falls along the reading scale.
 *
 * Split from useReadingPosition because the cadences differ by orders of
 * magnitude: the needle moves on every scroll frame, but a station only moves
 * when the document reflows. Measuring these on scroll would be the one thing
 * in the status bar expensive enough to feel while typing.
 *
 * `outlineLength` is a change signal rather than data — the positions come from
 * the DOM, since the outline carries ProseMirror document positions and the
 * scale needs pixels. It is the cheapest available proxy for "the headings
 * changed", and the ResizeObserver catches everything it misses: renaming a
 * heading without adding one reflows nothing, so nothing needs remeasuring.
 */
export function useHeadingStations(outlineLength: number): HeadingStation[] {
  const [stations, setStations] = useState<HeadingStation[]>(NO_STATIONS)

  useEffect(() => {
    const scroller = document.querySelector('.workspace')
    if (!scroller) return

    let frame = 0
    const sample = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const next = measureStations(scroller)
        setStations(current =>
          current.length === next.length &&
          current.every(
            (station, i) =>
              station.level === next[i].level &&
              Math.abs(station.at - next[i].at) < 0.002,
          )
            ? current
            : next,
        )
      })
    }

    sample()

    const observer = new ResizeObserver(sample)
    observer.observe(scroller)
    const content = scroller.firstElementChild
    if (content) observer.observe(content)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [outlineLength])

  return stations
}
