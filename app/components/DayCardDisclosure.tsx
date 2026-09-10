"use client";

// A service that is NOT the next one, collapsed to a single line (spec §12.1):
// "SÁBADO · 19 sep        en 11 días ▾". Opening reveals the ordinary `DayCard`.
// Home renders the next service in full and every other one through this, so the
// page is the run sheet plus a couple of lines instead of a wall of cards.
//
// The caller only hands this a service whose card actually paints (home filters
// on `paintsDayCard` before splitting hero from rest) — a header over an empty
// `Collapse` would open onto nothing.
//
// `Collapse` keeps its children mounted, so the `DayCard` inside a closed one
// still runs `usePlayer`/`useSession`; both providers are global, and a closed
// Collapse is inert + aria-hidden, so nothing inside it is reachable.

import { useId, useState } from "react";
import { DayCard, type DayCardProps } from "./DayCard";
import Collapse from "./ui/Collapse";
import { daysUntil, formatCountdown } from "@/app/utils/daysUntil";

export default function DayCardDisclosure(props: DayCardProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  // Local noon, never a bare `new Date(iso)` — the UTC day-flip invariant.
  const shortDate = props.date
    ? new Date(props.date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : "";
  const days = props.date ? daysUntil(props.date) : null;

  return (
    <div className="overflow-hidden rounded-[var(--brand-radius-panel)] border border-ink-dim/15">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="font-display text-lg uppercase text-ink">
          {props.day}
          {shortDate && <span className="text-ink-dim font-normal"> · {shortDate}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-3 font-label text-[11px] uppercase tracking-widest text-ink-dim">
          {days !== null && formatCountdown(days).toLowerCase()}
          {/* `currentColor` on purpose: `var()` is not substituted inside an SVG
              presentation attribute, so the stroke inherits the span's colour. */}
          <svg
            aria-hidden
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`transition-transform duration-base ease-out-brand ${open ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {/* The padding rides on Collapse's inner div: a padded animated element
          floors its own height under border-box and never closes to zero. */}
      <Collapse open={open} id={id} className="px-2 pb-2">
        <DayCard {...props} />
      </Collapse>
    </div>
  );
}
