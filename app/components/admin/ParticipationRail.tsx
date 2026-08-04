// app/components/admin/ParticipationRail.tsx
//
// The participation panel, placed in the Tablero's empty side gutter instead of
// in a column of its own — so the dialog it sits beside keeps every pixel it
// has today. It is PLACEMENT ONLY: the chart is `ParticipationSidebar`,
// unchanged, and the live-vs-saved arithmetic belongs to the caller
// (`boardParticipationRoles`). Nothing here decides what is counted.
//
// ── ONE surface now, not two, and why the other one left ──────────────────
// This file used to serve the planner grid as well (`placement="panel"`, gutter
// at ≥1700px). It no longer does. The planner grid's chart is an ordinary
// in-flow COLUMN of `PlannerGrid`'s three-column workspace at every viewport
// width, because the gutter answer never reached the machine it was for: the
// admin page caps content at `max-w-7xl` (1280px), so a 1512px 14" MacBook Pro
// — the screen this app is actually planned on — has ~116px of gutter and the
// rail simply never appeared. Paying for the panel out of the grid's width, on
// every machine including the ultrawide where the gutter DID work, is a
// deliberate trade and not a regression. See `PlannerGrid.tsx`'s header.
//
// The Tablero keeps the gutter because its geometry is different in kind: it is
// a height-bounded two-pane dialog whose whole reason for existing is NOT
// stacking a third scroll region into one narrow column (see `SeatBoard.tsx`'s
// header), and its `max-w-4xl` (896px) shell leaves a real gutter from 1380px
// up — which every machine in use here clears.
//
// ── Why `position: fixed`, and why these exact widths ──────────────────────
// `CueDialog` caps the Tablero at `max-w-4xl` (896px, `CueDialog.tsx:97`) and
// centres it, so the gutter is real screen space no element can reach from
// inside the flow. Only a viewport-anchored element can use it without
// narrowing the container — which is the entire point.
//
// The threshold is arithmetic, not taste. The rail is 216px at `left-2` (8px)
// and leaves 8px of air, so it needs 232px before the container's first pixel
// of content; the dialog has no inner padding to borrow:
//   • dialog: (W - 896) / 2 >= 232  →  W >= 1360. Set at 1380.
// A lower threshold would overlap the very content this exists not to shrink.
//
// 216px is also the floor, not a preference. The floor is the WIDEST ROW inside
// `ParticipationSidebar`, and there are two of them — deriving it from one row
// and forgetting the other is exactly how this shipped broken once:
//   • the member row: a hard 150px inline bar + a 10px gap + a 24px count
//     column, inside 12px padding and a 1px border either side, plus the 2px
//     right padding of the `overflow-y-auto` scroller the rows sit in — 212px
//     before the count column starts printing itself on top of the bar (the
//     stated 208 was two terms short, and both were found by measuring rather
//     than by reading, which is why the guard now derives this). The bar's
//     `width: 150px` is an INLINE style and cannot shrink; the name block around
//     it is `flex-1 min-w-0` and shrinks instead, so the failure is an overlap
//     rather than a clip, and nothing overflows the box to give it away.
//   • the header row: the title (~131px) above a `w-full` Voces/Instrumentos
//     select — 131px + the same 24px of padding, 155px.
// The SAME floor governs the planner grid's left column, which is why that
// column is also 216 (`PlannerGrid.CHART_COLUMN_WIDTH`). It shipped at 190 for
// one release and the count column overlapped the bar by 10px on every member
// row — the defect this paragraph exists to prevent, reached by a surface that
// never consulted this number. Both are now pinned against the sidebar's own
// source in `participationAlongside.test.tsx`.
// 216 clears both. It did NOT clear the header while that select sat BESIDE the
// title: a `<select>` is as wide as its widest option ("Instrumentos", 112px),
// so the header asked for 131 + 8 + 112 + 24 = 275, and a real browser measured
// the chart at 262px of content in a 216px box with the select's right edge 47px
// out over the planner grid. Stacking the header (`ParticipationSidebar.tsx`)
// made each row ask for the wider of the two rather than their sum. If either
// row grows past 192px of content, this number and the threshold move with it
// — `participationAlongside.test.tsx` refuses to let the two drift apart.
//
// ── Below the threshold the dialog renders no rail at all ──────────────────
// There is no gutter, and re-introducing a third scroll region inside a
// two-pane dialog to show a chart would trade the fix for the feature.
//
// ── Why a media QUERY and not a `min-[1380px]:` class ──────────────────────
// The panel must be genuinely ABSENT below the threshold, not merely hidden: a
// CSS-only answer would need the component mounted twice and the duplicate
// would put two "Participaciones" headings and two Voces/Instrumentos selects
// in the accessibility tree at all times. One instance, one place.
//
// ── Why the GUTTER placement is portalled to `document.body` ───────────────
// This is a WebKit workaround, NOT a spec requirement, and the distinction is
// the whole reason this paragraph exists. Per spec a `position: fixed` element
// whose containing block is the viewport is NOT clipped by an ancestor's
// `overflow: hidden` — `relative` does not establish a containing block for it,
// only `transform`/`filter`/`backdrop-filter`/`perspective`/`contain`/
// `container-type`/`will-change` do, and an audit of the live chain found none
// of those on any ancestor. Chromium paints the rail correctly mounted in
// place, and a reader who checks the spec will conclude this portal is
// pointless and remove it.
//
// In real Safari it is not pointless: the rail measures its correct box
// (216 × 563 at 8,112), reports `display: block` / `visibility: visible`, wins
// `elementFromPoint` at its own centre, accepts a `background-color` — and
// paints NOTHING. That fingerprint (correct layout, correct hit-testing, no
// paint) is a compositing failure, not a layout one, and the only thing that
// distinguishes this element from every other painted element on the page is
// its ancestor chain: `.brand-facet-panel` carries `position: relative` +
// `isolation: isolate` + `overflow: hidden` (`app/brand.css`), the shape WebKit
// has historically mis-composited fixed descendants out of. The portal takes
// the rail out of that chain entirely. It reaches the Capacitor iOS wrap too,
// which is the same engine. The user has confirmed the fix works in real
// Safari; headless WebKit never reproduced the bug, so do not "verify" it away.
//
// The component stays MOUNTED where it is and only its OUTPUT moves, so it
// still reads the board's seat state directly — see the mount comment in
// `SeatBoard.tsx`, which is about state, while this is about paint.
"use client";

import React, { useCallback, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { ParticipationSidebar } from "./ParticipationSidebar";
import type { ParticipantRole } from "@/app/utils/computeParticipation";

/**
 * One member, and deliberately still a union: the value is what
 * `data-participation-rail` renders, and the planner grid's own column carries
 * `data-participation-rail="panel"` (`PlannerGrid.tsx`) so both charts stay
 * findable by one selector. Widening this back to `"panel"` would put a fixed
 * element back inside `.brand-admin-shell` — read this file's header first.
 */
export type RailPlacement = "dialog";

/** Viewport width at which the dialog's gutter can hold the rail. See above. */
export const MIN_WIDTH: Record<RailPlacement, number> = { dialog: 1380 };

/**
 * The rail's width in the gutter — the widest row inside `ParticipationSidebar`
 * plus its padding, and the input to the threshold above. Exported so a test
 * can pin the rendered class against the number the arithmetic is stated in,
 * rather than against a literal copied into an assertion.
 */
export const RAIL_WIDTH = 216;

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
  // of a tree that re-renders on every seat click, and `matchMedia` allocates a
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
  containerRef,
}: {
  roles: ParticipantRole[];
  monthLabel: string;
  placement: RailPlacement;
  /**
   * The portalled node, handed back to the caller. Exists so the dialog this
   * rail was mounted inside can put it back in its Tab ring after the portal
   * above took it out of the shell — see `useCueDialogFocusSatellite` in
   * `CueDialog.tsx`. A callback ref, not an object ref, because it must fire on
   * DETACH too: below the threshold this component returns `null`, and a stale
   * node left in a focus ring is worse than no node at all.
   */
  containerRef?: React.Ref<HTMLDivElement>;
}) {
  const wide = useWideGutter(MIN_WIDTH[placement]);
  if (!wide) return null;

  const chart = (
    <div
      ref={containerRef}
      data-participation-rail={placement}
      data-rail-placement="gutter"
      className={`${RAIL_CLASS} top-20`}
    >
      <ParticipationSidebar roles={roles} monthLabel={monthLabel} />
    </div>
  );

  // No SSR guard is needed and none should be added: `wide` can only be true
  // once `useWideGutter` has a real `MediaQueryList`, which it refuses to build
  // without a `window` — and `useSyncExternalStore`'s server snapshot is a hard
  // `false`, so the first (hydrating) client render returns `null` too.
  // `document` therefore exists everywhere this line runs.
  return createPortal(chart, document.body);
}
