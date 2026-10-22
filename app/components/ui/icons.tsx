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

/** A song's music (the YouTube reference) — the «Ensayar» menu's first choice. */
export function MusicNoteIcon(props: IconProps) {
  return (
    <Icon name="music-note" {...props}>
      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </Icon>
  );
}

/** Lyrics (the sung version) — the «Ensayar» menu's second choice. */
export function MicIcon(props: IconProps) {
  return (
    <Icon name="mic" {...props}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" />
    </Icon>
  );
}
