# ADR-0045: Every planner-grid occupant gets a named chip — no `+N`

**Date:** 2026-09-28 · **Status:** Accepted

> **Numbering.** ADR numbers follow the order records reach `main`. This record
> was written as 0044 on its branch. It became 0045 when `main` merged PR #109
> (ADR-0044, the Servicios board's vertical scroll) first, on 2026-09-28.

## Context

The planner grid's D7 (`docs/superpowers/plans/2026-07-29-planner-grid.md:84`)
capped a row that carries a `target` — Lead, BGV and Coro — at that target and
put everyone past it behind a focusable `+N` button. The button named nobody,
and by design it had no drag handle: DD11 of the drag-and-drop plan
(`docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md:144`) made the
picker-row anchor "the **only** anchor for occupants hidden behind `+N`",
restated in ADR-0012's DD8.

A same-day camp month (October 2026, five special sets) put a third Lead on four
of the five columns. The admin saw `Lali, Marianne +1` and the amber «Por encima
del objetivo» warning on each, and could neither tell who the extra person was
nor drag them to the set that needed them — the exact move the warning asks for.
Reaching them meant opening the cell, finding the seated row in the picker and
using «Marcar para mover». Frank, 2026-09-28: «Odio que solo muestre el +1 y no
pueda arrastrar esa pill ni saber quién es».

D7's own reasoning was about not hiding information ("hiding information in the
surface built to stop hiding it"). The cap kept a normally-staffed service
compact, which it still is — the cap only ever bit on an over-target cell, and
that is the cell where the hidden name matters most.

## Decision

`GridCellView` in `app/components/admin/PlannerGrid.tsx` renders every occupant
as a chip — named, focusable for pick-then-place, and `draggable` — on every
row. The `+N` button is gone.

The over-target warning stays and gets more specific. `hasTarget`
(`plannerModel.ts`) still decides which rows have a threshold. On those rows:

- the cell keeps its amber border and its «Por encima del objetivo — se acepta
  de todos modos» line;
- each chip at an index past `target` takes the `+N`'s old amber border and
  fill, carries `data-over-target="true"`, and adds «(por encima del objetivo)»
  to its accessible name. Its text stays `text-ink-muted`, like every other
  chip: the `+N`'s `text-warning-strong` measured about 3.5:1 on that fill in the
  light theme, under AA for 12px text, and the name is the thing this change
  exists to show.

A conflict (duplicate or unwaived rule, red) outranks a Tipo mismatch, which
outranks the over-target tint.

The DD11 picker-row anchor is unchanged. It stays because a ~20px chip is not a
44px touch target and DD8 routes touch through pick-then-place. It is no longer
the only handle an over-target occupant has.

## Rejected

- **Keep `+N` and make it draggable.** A pill with no name is still a guess: the
  admin would drag without knowing who. It would also need a rule for which of N
  hidden people a drag moves.
- **Name the hidden people in the `+N` label (`+Hugo`).** That is a chip under
  another name, without the pick-then-place and conflict treatment a chip already
  has, so it would be a second occupant control to keep in step.
- **A `title` or hover list.** D7 ruled it out, and the reason still holds: the
  iOS build is a web wrap, and `title` never fires on touch.

## Consequences

- An over-target cell grows by a chip. At the narrowest track (full screen,
  `minmax(0, 1fr)`) a three-Lead cell may wrap to a second line of chips.
  Vertical space is the cheap axis in this grid, which D7 itself noted.
- A member seated twice in one cell (DD10 allows it) now renders twice, so chip
  keys count occurrences (`id#n`) rather than using the bare id.
- Which occupant counts as "extra" follows array order, meaning the ones past the
  first `target`. That is the order the solver and manual appends produce. It is
  a display cue, not a ranking, and nothing is ever evicted (D6).
- Restoring the cap means restoring a second route for moving the hidden tail.
  The tests that pin this — `PlannerGrid.test.tsx` «cell density»,
  `plannerGridDrag.test.tsx` «the drag's anchors» and `plannerGridPickPlace.test.tsx`
  «acceptance 12» — fail if the tail loses its chip.

## Amendment 2026-09-30 — «Solo llenar vacíos» adds a fourth rung

The precedence above gains one rung. With «Solo llenar vacíos» on, a seat that will be pinned —
or is left out as a same-service duplicate — and contradicts something gets a pin-conflict
treatment: the person is unavailable that day, is outside the solver's pools for that seat, or
already sits elsewhere in the same service and so is not sent.

- **Where it sits.** Between Tipo mismatch and over-target: a conflict (red) still outranks it,
  and it outranks the over-target tint. It shares the Tipo-mismatch tint, so the visible order is
  conflict, then Tipo mismatch or pin conflict, then over-target.
- **What it adds.** Its own suffix on the chip's `aria-label` and a words line under the cell,
  so the reason is named rather than only tinted.
- **It is shown and never blocks (E3).** The pin wins; the chip informs the admin and nothing
  refuses the seat.

Source: `PIN_CONFLICT_ARIA` / `PIN_CONFLICT_LINE` in `app/components/admin/PlannerGrid.tsx`; spec
`docs/superpowers/specs/2026-09-29-planner-trailing-saturday-and-fill-empty-design.md` §3.3.
