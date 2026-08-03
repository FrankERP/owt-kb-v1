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
// The thresholds are arithmetic, not taste. The rail is 216px at `left-2`
// (8px) and leaves 8px of air, so it needs 232px before the container's first
// pixel of CONTENT. The admin page adds `px-6` inside `max-w-7xl`, so its
// content starts 24px further in than the box does; the dialog has no such
// padding:
//   • panel:  (W - 1280) / 2 + 24 >= 232  →  W >= 1696. Set at 1700.
//   • dialog: (W -  896) / 2      >= 232  →  W >= 1360. Set at 1380.
// A lower threshold would overlap the very content this exists not to shrink.
//
// 216px is also the floor, not a preference: `ParticipationSidebar`'s bar is a
// hard 150px inline width plus a 10px gap and a 24px count column inside 12px
// padding — 208px before it clips.
//
// What this reaches, concretely: any external monitor (1920/2560) and a 16"
// MacBook Pro (1728 logical) get the rail beside the grid. A 14" (1512) or a
// 13" Air (1470) has ~140px of usable gutter, which cannot hold a 208px chart
// at any threshold — those fall back to the stacked placement below. The
// Tablero's 1380px gate clears all three.
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
// ── Why a media QUERY and not a `min-[1700px]:` class ─────────────────────
// Both placements need the panel to be genuinely ABSENT below the threshold —
// `dialog` because it must not exist at all, `panel` because a CSS-only answer
// would need the component mounted twice (once fixed, once in flow) and the
// duplicate would put two "Participaciones" headings and two Voces/Instrumentos
// selects in the accessibility tree at all times. One instance, one place.
"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { ParticipationSidebar } from "./ParticipationSidebar";
import type { ParticipantRole } from "@/app/utils/computeParticipation";

export type RailPlacement = "panel" | "dialog";

/** Viewport width at which each surface's gutter can hold the rail. See above. */
const MIN_WIDTH: Record<RailPlacement, number> = { panel: 1700, dialog: 1380 };

const RAIL_CLASS = "fixed left-2 z-40 w-[216px]";

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
  // ONE `MediaQueryList` per mounted rail. `getSnapshot` runs on every render
  // of a tree that re-renders on every cell click, and `matchMedia` allocates a
  // live object each call. Scoped to the component rather than cached in a
  // module: a module-level cache outlives the `window` it was built against,
  // which is wrong under jsdom and wrong after any environment swap.
  const mql = useMemo(
    () =>
      typeof window === "undefined" || typeof window.matchMedia !== "function"
        ? null
        : window.matchMedia(query),
    [query],
  );
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!mql) return () => {};
      // `addListener` is the deprecated spelling Safari kept for years; the
      // fallback costs one line and covers an iOS WebView older than the
      // Capacitor wrap's floor.
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
      }
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    },
    [mql],
  );
  return useSyncExternalStore(
    subscribe,
    () => mql?.matches ?? false,
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
