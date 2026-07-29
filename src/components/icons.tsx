import type { SVGProps } from 'react'

/**
 * App icons, drawn on a shared 24-unit grid so they all carry the same optical
 * weight. The unicode glyphs these replaced came from whatever fallback font
 * the OS picked per codepoint, which is why they never lined up.
 *
 * Geometry follows the Lucide grid (MIT). `currentColor` means the toolbar's
 * `[aria-pressed='true']` accent rule and dark-mode tokens apply for free.
 */
const base: SVGProps<SVGSVGElement> = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  width: 16,
  height: 16,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  // Every button that hosts an icon carries its own title + aria-label.
  'aria-hidden': true,
  focusable: false,
}

type IconProps = SVGProps<SVGSVGElement>

export function BulletListIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      {/* Round caps turn these zero-length segments into the bullets. */}
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}

export function OrderedListIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 6h11M10 12h11M10 18h11" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  )
}

export function TaskListIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m3 7 2 2 4-4" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8M13 12h8M13 18h8" />
    </svg>
  )
}

/* Quote marks rather than the indented-text shape: sitting next to three list
 * icons, anything built from horizontal rules just reads as a fourth list. */
export function QuoteIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 6H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a2 2 0 0 1-2 2v1" />
      <path d="M20 6h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a2 2 0 0 1-2 2v1" />
    </svg>
  )
}

/* CodeBlockIcon and TableIcon share a frame: both are block-level inserts, and
 * it separates them from the bare `</>` inline-code button. */
export function CodeBlockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m10 9-3 3 3 3" />
      <path d="m14 9 3 3-3 3" />
    </svg>
  )
}

export function TableIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3v18" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
    </svg>
  )
}

export function ImageIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  )
}

export function HorizontalRuleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function UndoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

export function RedoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  )
}

/* --- Header --- */

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  )
}

export function UploadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function CommentIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </svg>
  )
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/** The comment rail, as a panel docked to the right edge of the workspace. */
export function PanelRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </svg>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
      <path d="m4.93 4.93 1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

/* --- Links --- */

export function LinkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <path d="M8 12h8" />
    </svg>
  )
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

/* --- Documents --- */

/* A clock face with the arrow running anticlockwise: this is "back through
 * time", not "undo" — the toolbar already owns that arrow. */
export function HistoryIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  )
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

/* --- Tables ---
 *
 * The structural four share TableIcon's frame, cropped to the axis they act
 * on — a wide, short frame for rows, a tall, narrow one for columns — with the
 * +/− sign outside it, on the edge where the change lands. The alignment three
 * deliberately have no frame: they are a property of the text, not of the
 * grid, and framing them would group them with the wrong neighbours. */

export function RowPlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="18" height="11" rx="2" />
      <path d="M3 8.5h18" />
      <path d="M12 17v5M9.5 19.5h5" />
    </svg>
  )
}

export function RowMinusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="18" height="11" rx="2" />
      <path d="M3 8.5h18" />
      <path d="M9.5 19.5h5" />
    </svg>
  )
}

export function ColumnPlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="11" height="18" rx="2" />
      <path d="M8.5 3v18" />
      <path d="M19.5 9.5v5M17 12h5" />
    </svg>
  )
}

export function ColumnMinusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="11" height="18" rx="2" />
      <path d="M8.5 3v18" />
      <path d="M17 12h5" />
    </svg>
  )
}

export function AlignLeftIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h16M4 12h10M4 18h13" />
    </svg>
  )
}

export function AlignCenterIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h16M7 12h10M6 18h12" />
    </svg>
  )
}

export function AlignRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h16M10 12h10M7 18h13" />
    </svg>
  )
}

/** TableIcon with the top band filled — the band IS the distinction. */
export function HeaderRowIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      {/* `base` sets fill: none, so the band has to declare its own. */}
      <path
        d="M5 3h14a2 2 0 0 1 2 2v4H3V5a2 2 0 0 1 2-2Z"
        fill="currentColor"
        stroke="none"
        opacity="0.3"
      />
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M12 9v12" />
    </svg>
  )
}

/**
 * The app's brand mark — the deliberate exception in this file. Every icon
 * above spreads `base`: 24-unit grid, `fill: none`, `stroke: currentColor`,
 * `aria-hidden`. A two-colour filled logo can honour none of that, so this one
 * carries its own viewBox, its own literal fills, and an accessible name — it
 * is the only thing on screen that names the app.
 *
 * Geometry and colours mirror `public/pwa-source.svg`; change them together.
 * The gradient ids are prefixed because ids in inline SVG are document-global.
 */
export function BrandMark(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1254 1254"
      width={22}
      height={22}
      role="img"
      aria-label="Yiannis Mertzanis' Markdown"
      focusable={false}
      {...props}
    >
      <defs>
        <linearGradient id="brand-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b3512f" />
          <stop offset="0.5" stopColor="#b3512f" />
          <stop offset="1" stopColor="#a5482a" />
        </linearGradient>
        <linearGradient id="brand-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#faf9f7" />
          <stop offset="0.52" stopColor="#f7f4ee" />
          <stop offset="1" stopColor="#f2efe9" />
        </linearGradient>
      </defs>

      <rect width="1254" height="1254" fill="url(#brand-tile)" />

      <g
        fill="url(#brand-mark)"
        transform="translate(627 627) scale(0.9) translate(-627 -627)"
      >
        {/* Central Y with integrated downward arrow */}
        <path d="M 320 235 H 458 L 627.5 419 L 797 235 H 935 L 679 503 V 889 H 763 L 627.5 1045 L 492 889 H 576 V 503 Z" />
        {/* Outer M strokes */}
        <path d="M 248 350 L 479 595 L 548 524 V 645 L 479 719 L 331 562 V 905 H 248 Z" />
        <path d="M 1007 350 L 776 595 L 707 524 V 645 L 776 719 L 924 562 V 905 H 1007 Z" />
        {/* Inner descending M strokes */}
        <path d="M 375 669 L 458 755 V 990 L 375 905 Z" />
        <path d="M 880 669 L 797 755 V 990 L 880 905 Z" />
      </g>
    </svg>
  )
}
