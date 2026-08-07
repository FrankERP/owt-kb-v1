# ADR-0012: Grid drag moves one seat, desktop only, with no auto-scroll

**Date:** 2026-08-06 · **Status:** Accepted

## Context

The month-grid drag-and-drop plan
(`docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md`) opened three scope
questions whose "obvious" answer is to build more, not less: could a drag swap
two occupants instead of relocating one; should touch — the app ships as a
Capacitor iOS wrap (`capacitor.config.ts`) — get its own lifted-chip gesture;
should the grid auto-scroll during a drag so an off-screen column becomes
reachable. Tracked as open questions O1–O3, they were resolved with the user
on 2026-08-06 as DD7, DD8 and DD9
(`docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md:160`).

## Decision

- **DD7 — no seat-level swap by drag.** `moveGate.ts`/`moveOccupant.ts`
  implement single-occupant relocation only; exchanging two people is two
  drags (or two pick-then-place moves).
- **DD8 — desktop-only HTML5 drag.** `PlannerGrid.tsx:328-336` chooses HTML5
  drag (`draggable` + `onDragStart`/`onDragOver`/`onDrop`) over pointer
  events specifically because `dragstart` never fires from a touch. Touch and
  keyboard are served instead by pick-then-place ("Marcar para mover" on a
  focusable occupant chip via Enter/Space, or the picker-row anchor for
  `+N`-hidden occupants), which runs the same `moveOccupant`/`moveGate`
  primitives as the drag.
- **DD9 — no edge auto-scroll.** The native HTML5 drag scrolls nothing on its
  own; visible columns only — scroll the grid into view, then drag.

## Rejected

- **Seat-level swap by drag.** The grid already has an atomic,
  revision-guarded column swap route
  (`app/api/admin/roles/swap/route.ts`). A second swap mechanism with drag
  semantics would be a new concurrency surface built for a case two ordinary
  drags already cover.
- **Touch drag via pointer events.** It needs long-press-to-lift, which fights
  the grid's horizontal scroll — exactly the conflict the Capacitor iOS wrap
  would hit. Pick-then-place reaches every move a drag reaches without that
  gesture conflict, so building a second, touch-specific lift mechanism buys
  nothing pick-then-place does not already cover.
- **Edge auto-scroll.** Fiddly and additive later; excluding it changes
  nothing else in this plan.

**Known nuance, recorded honestly rather than assumed:** iPadOS
Safari/WKWebView appears to deliver HTML5 drag from a long press, so DD8's
"touch never fires `dragstart`" mechanism may not hold on iPad specifically.
This is unverified as of this writing — DD8's stated *reason* (avoiding a
long-press gesture that fights the grid's scroll) still applies to the iPhone
form factor the Capacitor app ships on; a real-device iPad check remains
outstanding.

## Consequences

- A seat-level swap is not available from the grid. Building one later must
  either reuse the existing atomic column-swap route's concurrency guard or
  knowingly accept a second, different one — don't add a drag-native swap
  without going back to that route's revision guard.
- Touch users get pick-then-place, not a lifted chip. Do not "fix" the
  Capacitor build by wiring `dragstart` to touch events — it does not fire
  there, and pick-then-place already covers what the drag covers, including
  the cross-service case a same-service action could not reach.
- A column off-screen is simply not a drop target until the admin scrolls to
  it; there is no drag-triggered scroll to rely on.
- **The drag makes an existing, unremoved exposure feel worse without
  changing it.** The save loop PATCHes sequentially and continues past a
  known failure (T6): each PATCH independently fires
  `notifyRoleAssignments`/`queueRoleNotices`
  (`app/api/admin/roles/[id]/route.ts`) for published (or grandfathered)
  services only — a draft edit stays silent
  (`app/api/admin/roles/[id]/route.ts:396-398`). A cross-service drag whose
  source PATCH commits and whose target PATCH is rejected therefore emails
  the member a removal with no matching addition. The exposure is not new —
  the pre-drag two-edit workflow had it too, and stays visible and retryable
  — but the drag makes it **one gesture the admin perceives as atomic, where
  two edits made both steps visible.** Pinned by
  `MonthGenerator.storedMove.test.tsx:343-401` ("keeps a half-committed
  cross-service move visible and retryable"); the consequence itself is
  stated verbatim at lines 353-358 of that file.
