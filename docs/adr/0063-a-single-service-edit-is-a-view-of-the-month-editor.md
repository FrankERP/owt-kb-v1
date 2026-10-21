# ADR-0063: A single-service edit is a view of the month editor, not a second editor

**Date:** 2026-10-21 · **Status:** Accepted

## Context

A service card's «Editar equipo» opened «Editar mes»: the whole month, scrolled to
that service's column, with every month tool around it (Nuevo, Llenar especiales,
the two swaps, Equidad, Limpiar mes). Frank asked for a quick way to edit one
service. In August 2026 he had asked for the opposite direction on purpose — "this
will replace individual edits for a more robust edit view" — and the old per-service
`SeatBoard` dialog was deleted so that one editor held the rule checks, the save and
its notices (`docs/MONTH_GRID_EDITING.md`).

## Decision

The card's «Editar equipo» and its `service_modal` primary action open the same
stored `MonthGenerator`, with `singleService` (`ServicesPanel.openServiceEditor`):

- `PlannerGrid` receives every column and cell of the month and DRAWS only
  `onlyColumnId`. Every judgement — the picker's load order, rule checks, duplicate
  checks, the participation chart — still reads the whole month.
- The month tools are hidden, and so is «⛶ Pantalla completa» (one column already
  fits). The page title reads «Editar servicio»; the footer's button reads «Guardar».
- «Ver mes completo» widens the view in place. It does not remount the editor, so
  an unsaved edit survives, and it is one way.
- A focused service that is not in the month's inventory falls back to the month.

The save is the stored editor's own PATCH, so revisions, notices
(`docs/NOTIFICATIONS.md`, ADR-0054) and cache revalidation are unchanged.

## Rejected

- **A dialog over the board with its own seat list and save.** It feels lighter, but
  it is the `SeatBoard` that was retired: a second writer whose rules, revision
  handling and notices must be kept in step with the grid's by hand.
- **Passing only the one column to `PlannerGrid`.** The picker ranks by load over the
  grid's own cells (D12), and the stored month is the only source of the other
  services' seats. With one column, someone who already leads twice this month would
  read as having served nothing. `PlannerGrid.test.tsx` («draws one column, judges
  the month») fails if the hidden column stops counting.

## Consequences

The single-service view still loads the planner chunk and the whole month, so it
opens no faster than «Editar mes». It saves clicks and scrolling, not load time.
Anything new added to the month editor's toolbar must decide whether it belongs in
the single-service view (`singleView` in `MonthGenerator`).
