// The small line icons the member pages share (2026-10-22, «símbolos de texto por
// iconos»). They replace the text glyphs that used to stand in for them — «‹ ›»
// on the month header, «← Mi semana», the «›» of a list row, «↗» on a link that
// leaves the sheet, «⚠» on a double booking, «↓» on a download, «✓» on a toast —
// which iOS draws from a fallback font at its own weight and baseline, so they
// never sat level with the drawn icons beside them (the tab bar, the buttons).
//
// NEUTRAL module — no hooks, no "use client" — so a Server Component may render
// one as JSX (ADR-0028). `currentColor` throughout: `var()` is not substituted
// in an SVG presentation attribute, so the stroke inherits the parent's colour.
// `data-icon` names the glyph for tests, which can no longer match the character.

import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Icon({ size = 14, name, strokeWidth = 2, children, ...rest }: IconProps & { name: string; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return <Icon name="chevron-left" {...props}><path d="m15 18-6-6 6-6" /></Icon>;
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon name="chevron-down" {...props}><path d="M6 9l6 6 6-6" /></Icon>;
}

export function ChevronRightIcon(props: IconProps) {
  return <Icon name="chevron-right" {...props}><path d="m9 18 6-6-6-6" /></Icon>;
}

export function ArrowLeftIcon(props: IconProps) {
  return <Icon name="arrow-left" {...props}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></Icon>;
}

/** A link that leaves the current surface (a PDF, the full song page). */
export function ExternalLinkIcon(props: IconProps) {
  return (
    <Icon name="external-link" {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" /><path d="M10 14 21 3" />
    </Icon>
  );
}

/** A double booking — the amber mark the agenda, the team sections and the card share. */
export function WarningIcon(props: IconProps) {
  return (
    <Icon name="warning" {...props}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" /><path d="M12 17h.01" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return <Icon name="check" {...props}><path d="M20 6 9 17l-5-5" /></Icon>;
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon name="download" {...props}>
      <path d="M12 4v12" /><path d="m6 11 6 6 6-6" /><path d="M4 20h16" />
    </Icon>
  );
}

/** A song's music — the «Ensayar» menu's «Banda completa» (the multitracks). */
export function MusicNoteIcon(props: IconProps) {
  return (
    <Icon name="music-note" {...props}>
      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </Icon>
  );
}

/** Lyrics (the sung version) — the «Ensayar» menu's «Video con letra». */
export function MicIcon(props: IconProps) {
  return (
    <Icon name="mic" {...props}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return <Icon name="plus" {...props}><path d="M12 5v14" /><path d="M5 12h14" /></Icon>;
}

export function ArrowRightIcon(props: IconProps) {
  return <Icon name="arrow-right" {...props}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Icon>;
}

/** Something that waits on someone else — a proposal pending an admin's answer. */
export function ClockIcon(props: IconProps) {
  return (
    <Icon name="clock" {...props}>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </Icon>
  );
}

/** Comments to read — a proposal sent back with changes requested. */
export function MessageIcon(props: IconProps) {
  return (
    <Icon name="message" {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Icon>
  );
}

/** A calendar with a plus — adding services to the member's own calendar. */
export function CalendarAddIcon(props: IconProps) {
  return (
    <Icon name="calendar-add" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
      <path d="M12 14v4" /><path d="M10 16h4" />
    </Icon>
  );
}

/** A calendar with a cross — the days a member cannot serve. */
export function CalendarOffIcon(props: IconProps) {
  return (
    <Icon name="calendar-off" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
      <path d="m10 14 4 4" /><path d="m14 14-4 4" />
    </Icon>
  );
}

/** Settings — the three sliders. */
export function SlidersIcon(props: IconProps) {
  return (
    <Icon name="sliders" {...props}>
      <path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" />
      <path d="M20 21v-5" /><path d="M20 12V3" />
      <path d="M1 14h6" /><path d="M9 8h6" /><path d="M17 16h6" />
    </Icon>
  );
}

/** Copy — two stacked sheets («Copiar enlace»). */
export function CopyIcon(props: IconProps) {
  return (
    <Icon name="copy" {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
  );
}
