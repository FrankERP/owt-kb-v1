"use client";

// The «Razón» note editor for one unavailable date.
//
// Moved out of `AvailabilityCalendar` when the weekend list arrived: both
// surfaces pin a note to a date, and two copies of a positioned popover is two
// places for the anchor tracking below to rot. The HOST owns the state (one
// popover for the whole panel, closed by the hook's `onAdopt` when a conflict
// drops the date it was pinned to) and this renders it.
//
// Deliberately NOT a `CueDialog`: it is a non-modal field beside the control that
// opened it, the member keeps reading the list behind it, and nothing underneath
// must go inert.

import { useEffect, useRef } from "react";

/** Height the popover is laid out against; it has no measured height until it exists. */
const POPOVER_H = 160;
const POPOVER_W = 272;

/** The open popover: which date, and where it sits in viewport coordinates. */
export interface NoteAnchor {
  iso: string;
  x: number;
  y: number;
  above: boolean;
}

/**
 * Where the note popover sits for the control that opened it, in viewport
 * coordinates.
 *
 * Pure and exported so the placement can be tested without a layout engine —
 * jsdom reports every rect as zero, so the only way to prove the flip and the
 * clamps is to feed them rects directly.
 */
export function popoverPosition(
  rect: { top: number; bottom: number; left: number },
  viewportW: number,
  viewportH: number,
): { x: number; y: number; above: boolean } {
  const above = rect.bottom + POPOVER_H > viewportH - 16;
  return {
    // Clamped at both ends: the right clamp alone goes negative on a viewport
    // narrower than the popover.
    x: Math.max(8, Math.min(rect.left, viewportW - POPOVER_W)),
    y: above ? rect.top - POPOVER_H - 6 : rect.bottom + 6,
    above,
  };
}

/** The long Spanish day label — the popover's title, and both surfaces' a11y names. */
export function fmtDayLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

export default function NotePopover({
  popover,
  setPopover,
  anchorRef,
  notes,
  setNote,
  remove,
}: {
  popover: NoteAnchor | null;
  setPopover: React.Dispatch<React.SetStateAction<NoteAnchor | null>>;
  /** The control the open popover belongs to, so its position can be recomputed. */
  anchorRef: React.RefObject<HTMLElement | null>;
  notes: Map<string, string>;
  setNote: (iso: string, text: string) => void;
  remove: (iso: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => setPopover(null);

  // Focus the input whenever the popover opens (or moves to another date).
  useEffect(() => {
    if (popover) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [popover?.iso]);

  /**
   * Keep the popover attached to the control it opened from.
   *
   * It is `position: fixed` at coordinates captured on click, so anything that
   * scrolls leaves it floating over an unrelated part of the page while still
   * bound to the original date — the member then types a reason for the wrong
   * day, or gives up on one they meant to explain. On a phone this is the
   * common path, not the edge: the on-screen keyboard scrolls the page as they
   * reach for the note field.
   *
   * Closing on scroll is the tempting one-liner and it is WORSE — that same
   * keyboard fires scroll and resize, so the popover would vanish at the moment
   * it opened. Recompute from the anchor instead. Capture phase, because the
   * scroll may happen in an ancestor rather than the window.
   */
  const popoverOpen = !!popover;
  useEffect(() => {
    if (!popoverOpen) return;
    const reposition = () => {
      const el = anchorRef.current;
      // Paging months unmounts every day button; a detached node reports a
      // zero rect, which would snap the popover to the top-left corner.
      if (!el?.isConnected) return;
      const p = popoverPosition(el.getBoundingClientRect(), window.innerWidth, window.innerHeight);
      // Only write on a real move, or the state update re-arms this effect forever.
      setPopover(prev =>
        prev && (prev.x !== p.x || prev.y !== p.y || prev.above !== p.above) ? { ...prev, ...p } : prev,
      );
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // `anchorRef` and `setPopover` are both stable (a ref object and a state
    // setter) — listed only because they are props here rather than local state.
  }, [popoverOpen, anchorRef, setPopover]);

  // Close on Escape
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover, setPopover]);

  if (!popover) return null;

  return (
    <>
      {/* Backdrop — click outside to close */}
      <div className="fixed inset-0 z-40" onClick={close} />
      <div
        className="fixed z-50 w-64 rounded-xl border border-accent/20 bg-surface-base shadow-2xl shadow-elevation/60 p-4 space-y-3"
        style={{ top: popover.y, left: popover.x }}
        onClick={e => e.stopPropagation()}
      >
        {/* Date label + close */}
        <div className="flex items-start justify-between gap-2">
          <p className="font-label text-[11px] uppercase tracking-widest text-availability-strong leading-tight capitalize">
            {fmtDayLabel(popover.iso)}
          </p>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar"
            className="text-mono-400 hover:text-mono-300 transition-colors shrink-0 -mt-0.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Note input */}
        <input
          ref={inputRef}
          type="text"
          placeholder="Razón (opcional)..."
          value={notes.get(popover.iso) ?? ""}
          onChange={e => setNote(popover.iso, e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") close(); }}
          className="w-full rounded-lg border border-surface-accent-l50-d15 bg-surface-lift/5 px-3 py-2 font-body text-sm text-mono-200 placeholder:text-placeholder focus:outline-none focus:border-accent/40 dark:focus:border-surface-accent-l50-d15"
        />

        {/* Remove date */}
        <button
          type="button"
          onClick={() => { remove(popover.iso); close(); }}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-negative-strong/20 font-label text-[11px] uppercase tracking-widest text-negative-fg/80 hover:border-negative-strong/40 hover:text-negative-fg transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Quitar esta fecha
        </button>
      </div>
    </>
  );
}
