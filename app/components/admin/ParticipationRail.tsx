// app/components/admin/ParticipationRail.tsx
//
// The participation panel, placed in the page's empty side gutter instead of in
// a column of its own — so the surface it sits beside keeps every pixel it has
// today. It is PLACEMENT ONLY: the chart is `ParticipationSidebar`, unchanged,
// and the live-vs-saved arithmetic belongs to the callers
// (`plannerParticipationRoles` for the grid, `boardParticipationRoles` for the
// Tablero). Nothing here decides what is counted.
//
// ── Why `position: fixed`, and why these exact widths ──────────────────────
// The admin page caps its content at `max-w-7xl` (1280px, `app/(client)/admin/
// page.tsx:18`) and the Tablero's dialog at `max-w-4xl` (896px,
// `CueDialog.tsx:97`). Both are centred, so the gutter is real screen space no
// element can reach from inside the flow. Only a viewport-anchored element can
// use it without narrowing the container — which is the entire request.
//
// The thresholds are arithmetic, not taste. The rail is 228px wide at `left-2`
// (8px), so it needs 236px of gutter:
//   • panel:  (W - 1280) / 2 >= 236  →  W >= 1752. Set at 1780 for slack.
//   • dialog: (W -  896) / 2 >= 236  →  W >= 1368. Set at 1400 for slack.
// A lower threshold would overlap the very content this exists not to shrink.
//
// ── Below the threshold there is no gutter, so the two surfaces differ ─────
// `panel` falls back to the normal flow: an ordinary block wherever it is
// mounted (below the grid), which STACKS rather than narrows, and keeps the
// signal available on an iPad or in the Capacitor iOS wrap.
//
// `dialog` renders nothing. The Tablero is a height-bounded two-pane dialog
// whose reason for existing is NOT stacking a third scroll region into one
// narrow column (see `SeatBoard.tsx`'s header). Re-introducing that to show a
// chart would trade the fix for the feature.
//
// ── Why a media QUERY and not a `min-[1780px]:` class ─────────────────────
// Both placements need the panel to be genuinely ABSENT below the threshold —
// `dialog` because it must not exist at all, `panel` because a CSS-only answer
// would need the component mounted twice (once fixed, once in flow) and the
// duplicate would put two "Participaciones" headings and two Voces/Instrumentos
// selects in the accessibility tree at all times. One instance, one place.
"use client";

import { useCallback, useSyncExternalStore } from "react";

import { ParticipationSidebar } from "./ParticipationSidebar";
import type { ParticipantRole } from "@/app/utils/computeParticipation";

export type RailPlacement = "panel" | "dialog";

/** Viewport width at which each surface's gutter can hold the rail. See above. */
const MIN_WIDTH: Record<RailPlacement, number> = { panel: 1780, dialog: 1400 };

const RAIL_CLASS = "fixed left-2 z-40 w-[228px]";

/**
 * Whether the viewport is at least `minWidth` wide, as a subscription rather
 * than a one-shot read: an admin who drags the window wider (or rotates an
 * iPad) gets the rail without a reload.
 *
 * Answers `false` when there is no `window.matchMedia` — during SSR, and in
 * jsdom, whose stub reports `matches: false` for everything anyway. Both are
 * the honest answer: neither can prove a gutter exists.
 */
function useWideGutter(minWidth: number): boolean {
  const query = `(min-width: ${minWidth}px)`;
  const list = useCallback(
    () =>
      typeof window === "undefined" || typeof window.matchMedia !== "function"
        ? null
        : window.matchMedia(query),
    [query],
  );
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = list();
      // `addListener` is the deprecated spelling Safari kept for years; the
      // fallback costs one line and covers an iOS WebView older than the
      // Capacitor wrap's floor.
      if (!mql) return () => {};
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
      }
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    },
    [list],
  );
  return useSyncExternalStore(
    subscribe,
    () => list()?.matches ?? false,
    () => false,
  );
}

export function ParticipationRail({
  roles,
  monthLabel,
  placement,
}: {
  roles: ParticipantRole[];
  monthLabel: string;
  placement: RailPlacement;
}) {
  const wide = useWideGutter(MIN_WIDTH[placement]);
  if (!wide && placement === "dialog") return null;

  return (
    <div
      data-participation-rail={placement}
      data-rail-placement={wide ? "gutter" : "inline"}
      className={wide ? `${RAIL_CLASS} ${placement === "dialog" ? "top-20" : "top-24"}` : undefined}
    >
      <ParticipationSidebar roles={roles} monthLabel={monthLabel} />
    </div>
  );
}
