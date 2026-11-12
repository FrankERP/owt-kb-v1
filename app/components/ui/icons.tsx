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

export function ChevronUpIcon(props: IconProps) {
  return <Icon name="chevron-up" {...props}><path d="m18 15-6-6-6 6" /></Icon>;
}

/** Dismiss or remove — the «X» on a row or a chip (CueDialog's own close stays its own). */
export function CloseIcon(props: IconProps) {
  return <Icon name="close" {...props}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>;
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

/**
 * The admin's calendar (2026-10-22): `AdminRail`'s Servicios item and the
 * Servicios toolbar's «Generar mes», which used to lead with 📅 — Apple's is a
 * red-and-white picture, not the button's colour. Drawn once here so the toolbar
 * cannot drift from the rail item it sits under.
 */
export function CalendarIcon(props: IconProps) {
  return (
    <Icon name="calendar" {...props}>
      <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" />
    </Icon>
  );
}

/** A member's availability note — the Disponibilidad matrix's mark on a date (was the ✎ emoji). */
export function NoteIcon(props: IconProps) {
  return (
    <Icon name="note" {...props}>
      <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9Z" />
      <path d="M15 3v4a2 2 0 0 0 2 2h4" />
    </Icon>
  );
}

/** «Pantalla completa» — the Servicios board's and the planner's toggle (was ⛶). */
export function ExpandIcon(props: IconProps) {
  return (
    <Icon name="expand" {...props}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
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

/** Where a meeting happens — the pin beside «Oasis Tlalpan». */
export function MapPinIcon(props: IconProps) {
  return (
    <Icon name="map-pin" {...props}>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </Icon>
  );
}

/** Several people — «Todo Jóvenes», a team, a group's section. */
export function UsersIcon(props: IconProps) {
  return (
    <Icon name="users" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  );
}

/** A keyboard — the «Keys» seat. */
export function KeysIcon(props: IconProps) {
  return (
    <Icon name="keys" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 5v8h2V5M14 5v8h2V5" /><path d="M9 13v6M15 13v6" />
    </Icon>
  );
}

/** A drum and its sticks — the «Drums» seat. */
export function DrumIcon(props: IconProps) {
  return (
    <Icon name="drum" {...props}>
      <ellipse cx="12" cy="10.5" rx="8" ry="3.2" />
      <path d="M4 10.5v6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-6" />
      <path d="m7 3 4 4.5M17 3l-4 4.5" />
    </Icon>
  );
}

/** A guitar — the string seats (EG, AG, Bass); the seat's own word says which. */
export function GuitarIcon(props: IconProps) {
  return (
    <Icon name="guitar" {...props}>
      <path d="m14.5 9.5 5-5" /><path d="m18 3 3 3" />
      <path d="M13.2 8.3a4.4 4.4 0 0 0-3.4 1.5c-.8.9-2 1-3.1 1.2A4.5 4.5 0 1 0 13 17.3c.2-1.1.3-2.3 1.2-3.1a4.4 4.4 0 0 0 1.5-3.4" />
      <circle cx="9.5" cy="14.5" r="1.3" />
    </Icon>
  );
}

/** A metronome — a song's tempo beside its BPM. */
export function MetronomeIcon(props: IconProps) {
  return (
    <Icon name="metronome" {...props}>
      <path d="M9 3h6l4 18H5L9 3Z" /><path d="m12 17 5-11" /><path d="M7 15h10" />
    </Icon>
  );
}

/** A gear — Ajustes. */
export function GearIcon(props: IconProps) {
  return (
    <Icon name="gear" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Icon>
  );
}

/** The pastor's word to the team — a megaphone on «Mensaje del pastor». */
export function MegaphoneIcon(props: IconProps) {
  return (
    <Icon name="megaphone" {...props}>
      <path d="M4 10v4l12 4V6L4 10Z" /><path d="M19 9.5a3.5 3.5 0 0 1 0 5" /><path d="M7 15v2.5a2 2 0 0 0 4 0v-1.2" />
    </Icon>
  );
}
