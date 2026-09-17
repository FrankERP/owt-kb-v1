# ADR-0035: The Control Room is the page — the admin shell is gone, and horizontal scroll is explicit

**Date:** 2026-09-17 · **Status:** Accepted

## Context

`/admin` framed its content three times over: the page's `brand-admin-frame`, a
bordered `.brand-admin-shell` card inside it, and then — per tab — a
`brand-surface rounded-2xl p-4 sm:p-6` panel box, inside which the panels draw
their own cards. Six mutually exclusive early `return`s in `AdminPanel` each
rendered their own `<TabBar>` and their own box, so the tab bar was six
components that happened to look alike.

The shell was also `position: relative` + `isolation: isolate` +
`overflow: hidden` on BOTH axes, and the premium-motion walk measured it
(spec Part III, finding 4) at `scrollWidth 1358` vs `clientWidth 1230`: a
programmatic `scrollIntoView` inside the planner shifted the whole workspace
128 px to the left and it stayed there, with no scrollbar and no page scroll to
show it had happened. `MonthGenerator` already centres the planner's column by
hand precisely to avoid triggering that climb.

That same trio is the WebKit compositing trap: a `position: fixed` descendant of
it lays out and hit-tests correctly in real Safari and paints nothing — the bug
`PlannerGrid`'s full-screen portal exists for.

## Decision

The page IS the workspace. `app/(client)/admin/page.tsx` renders the navbar, an
`h1`, and `AdminPanel` inside `brand-admin-frame` — no shell div, no eyebrow, no
subtitle, no status pill (label budget, decision N). `AdminPanel` renders ONE
tree: one `<TabBar>` and one body keyed by tab, with no `brand-surface` box
between them; the cards inside a panel are the only frames left.
`.brand-admin-shell`, its `::before` and `.brand-admin-tabs` are deleted from
`app/brand.css`.

**Horizontal scroll is explicit and local.** `/admin` has no page-level
horizontal scroll at any width. The planner grid, the Servicios board and the
availability matrix are the only horizontal scrollers, each inside its own
`overflow-x-auto` box, with its own scrollbar and its own bounds.

`brand-admin-frame` stays: the planner's `:has(.planner-wide)` widening hangs off
it (with `[data-route-main]`, the layout's own cap), and its `padding-inline:
0.75rem` is the 24 px the width derivation in `app/brand.css` spends —
`participationAlongside.test.tsx` pins the two against each other.
`adminShell.test.tsx` pins the flattened shape.

## Rejected

**Keep the shell and fix finding 4 in CSS** — `overflow-x: clip`, or
`overflow: visible` with the padding kept. Rejected for three reasons, in order
of weight. It leaves the compositing trap in place, so the portal and the
hand-centring stay anyway and the shell buys nothing they do not cost. It keeps
a clipping ancestor whose failure mode is silent by construction: the workspace
moves and nothing on screen says so, which is how finding 4 survived to be found
by JS measurement rather than by anyone's eyes. And it answers the wrong
question — the box was the third frame around content that is already cards, so
the fix that makes the surface right also makes the bug unreachable.

## Consequences

- The `:has(.planner-wide)` arithmetic changed with the shell's border and
  padding: `1512 − 24 = 1488` and `216 + 12 + 1008 + 12 + 240 = 1488`, restated
  in `app/brand.css` and `PlannerGrid.tsx`'s header and pinned against each
  other. R5 Task 2's rail spends width here again and re-pins it.
- **The full-screen portal and `MonthGenerator`'s hand-centring stay.** Neither
  was a workaround for THIS shell specifically: the portal survives whatever
  transformed, isolated or clipping ancestor arrives next (`PullToRefresh`, a
  route reveal, a future rail), and the hand-centring stops
  `scrollIntoView({ inline: "center" })` climbing to `[data-route-main]` — which
  is now the page itself, i.e. a worse outcome than the clipped shell, not a
  better one. Removing either "because the shell is gone" reads the comments
  backwards.
- A new `brand-surface` wrapper around a panel body, or a second `<TabBar>`,
  fails `adminShell.test.tsx` rather than shipping.
- The gallery's swatch set lost two tiles; `.brand-admin-shell` and
  `.brand-admin-tabs` are named in comments (here, in `brand.css`, in the portal
  and centring comments) but exist as rules nowhere.
