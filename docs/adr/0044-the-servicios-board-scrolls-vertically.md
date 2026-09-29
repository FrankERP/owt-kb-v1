# ADR-0044: The Servicios board scrolls vertically, beside a sticky Participaciones and a stowable rail

**Date:** 2026-09-28 · **Status:** Accepted — amends [ADR-0035](0035-the-admin-shell-is-gone.md)

## Context

R5 ruling 5 ([MOTION.md](../MOTION.md), «Task 4 (Servicios is a board)») made the
Servicios cards a horizontal snap track of fixed 380 px cards from `lg`
(`lg:flex lg:snap-x lg:snap-mandatory lg:overflow-x-auto`, a gradient fade at the right
edge). At the 1280 px cap (`max-w-7xl` inside `px-6` → 1232 px of content), with the
200 px rail and the 320 px Participaciones column, the track gets 656 px: ~1.7 cards in
view, the rest clipped at the right edge behind the fade. Frank, the only admin, used it
and asked on 2026-09-28 for three things: vertical scroll, a rail he can stow, and
Participaciones always in view while the services scroll.

## Decision

1. **The board is a vertical grid and the PAGE is the scroller.** The cards flow in
   `grid-cols-1 lg:grid-cols-[repeat(auto-fill,minmax(360px,1fr))]` in `ServicesPanel`;
   the track classes, the cards' `lg:w-[380px] lg:shrink-0 lg:snap-start` and the fade
   are gone. Column arithmetic under the unchanged 1280 cap: rail expanded
   `1232 − (200 + 32) = 1000`, minus the sidebar `320 + 24` → 656 → **1 column**; rail
   collapsed `1232 − (56 + 32) = 1144 − 344 = 800` → **2 columns**; never 3.
2. **Participaciones stays in view on the Servicios board at `lg+`.** `ParticipationSidebar`
   is sticky at the rail's own offset (`top-[calc(6rem+env(safe-area-inset-top))]`, the
   `lg:h-24` navbar) — the old `lg:top-4` slid under the sticky navbar — and is capped
   to the viewport height with its own vertical scroll, so a month with many members
   never pushes its bottom off-screen. The behaviour is opt-in from `ServicesPanel`; the
   planner's copy of the sidebar is unchanged.
3. **The `lg+` rail is user-collapsible** to the 56 px icons-only state the planner
   already forces at ≥1280 via `.brand-admin-frame:has(.planner-wide)` — one state, not a
   second one. The choice is persisted per browser in `localStorage` key
   `owt_admin_rail_collapsed`, read after mount (hydration-safe; one expanded→collapsed
   flip on first paint is accepted), every read and write in `try/catch`. While the
   planner forces the collapse the planner wins and the toggle is hidden. Below `lg` the
   underline strip is unchanged and has no toggle.
4. **The frame widening stays planner-only.** The collapsed rail frees width for the
   board; it does not lift the 1280 cap.

## Rejected

- **Keep the track and add prev/next buttons or map the wheel to horizontal.** Fixes the
  input, not the fact that most cards are off-screen.
- **An inner fixed-height scroller for the cards.** A second vertical scroller competing
  with the page's own scroll, `PullToRefresh` and the sticky navbar — when page scroll
  plus a sticky sidebar gives the same «sidebar stays, cards move» with native scrolling.
- **Lift the 1280 cap for three columns.** Re-opens the planner's pinned
  `:has(.planner-wide)` width derivation (ADR-0035, Consequences) for a nicety.
- **Hide the rail entirely.** Frank chose icons-only so navigation stays one click away.

## Consequences

- ADR-0035's «the planner grid, the Servicios board and the availability matrix are the
  only horizontal scrollers» now reads «the planner grid and the availability matrix».
  «No page-level horizontal scroll» is unchanged.
- `servicesBoard.test.tsx` now pins the OPPOSITE of what it pinned under ruling 5: no
  horizontal track. Restoring the track fails the suite.
- The collapsed width is still declared once, in `app/brand.css`; the user toggle and the
  planner's forced collapse land on the same rule.
- The preference is a per-browser convenience, not shared state: another device, or a
  cleared storage, starts expanded.
