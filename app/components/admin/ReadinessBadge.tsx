"use client";

// One readiness chip: icon + text + tone (Plan B item 7).
//
// Colour is never the only carrier of meaning — every badge renders its icon and
// its Spanish text, and the tone class only reinforces them. The icon is
// `aria-hidden` so a screen reader reads the label and text once.

import { TONE_CLASS, type ReadinessTone } from "./serviceCardModel";

export interface ReadinessBadgeProps {
  /** Module name (`Equipo`, `Setlist`…) or null for a bare state chip. */
  label?: string | null;
  text: string;
  icon?: string;
  tone: ReadinessTone;
  title?: string;
  className?: string;
}

export default function ReadinessBadge({
  label = null,
  text,
  icon,
  tone,
  title,
  className = "",
}: ReadinessBadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 ${TONE_CLASS[tone]} ${className}`}
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0 font-label text-[11px] leading-none">
          {icon}
        </span>
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {label && (
          <span className="block font-label text-[10px] uppercase tracking-widest opacity-70">
            {label}
          </span>
        )}
        <span className="block font-body text-xs leading-tight">{text}</span>
      </span>
    </span>
  );
}
