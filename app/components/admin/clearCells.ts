//
// «Borrar» (spec 2026-09-29 §3.1 E6, §3.2): clear voices, instruments or both, for one service or
// the whole month. FOH is never cleared in bulk — nothing refills it. Pure: `MonthGenerator` owns
// the confirm, the undo and the setters.

import type { GridCell, GridColumn, GridRow } from "./plannerModel";

export type ClearWhat = "voices" | "instruments" | "both";
export type ClearScope = { kind: "month" } | { kind: "service"; columnId: string };

export interface ClearPlan {
  /** `${columnId}|${rowId}` of every cell the clear empties. */
  cellKeys: Set<string>;
  /** Occupants removed — the live count every menu item shows. */
  seats: number;
  /**
   * Occupants in cells whose `origin` is `"manual"`. Approximate both ways: `origin` is per
   * cell, so an Auto pick in a hand-edited cell counts and a hand pick left in an Auto cell
   * does not — the dialog says «aproximadamente».
   */
  handPlacedApprox: number;
}

export const CLEAR_WHAT_LABEL: Record<ClearWhat, string> = {
  voices: "Voces",
  instruments: "Instrumentos",
  both: "Voces e instrumentos",
};

const keyOf = (c: { columnId: string; rowId: string }) => `${c.columnId}|${c.rowId}`;

function clears(row: GridRow, what: ClearWhat): boolean {
  if (row.category === "voz") return what !== "instruments";
  if (row.category === "instrumento") return what !== "voices";
  return false; // FOH
}

export function planClear(input: {
  cells: GridCell[];
  rows: GridRow[];
  columns: GridColumn[];
  scope: ClearScope;
  what: ClearWhat;
}): ClearPlan {
  const { cells, rows, scope, what } = input;
  const { columns } = input;
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const columnById = new Map(columns.map((c) => [c.columnId, c]));
  const inScope = scope.kind === "month" ? new Set(columns.map((c) => c.columnId)) : new Set([scope.columnId]);
  const plan: ClearPlan = { cellKeys: new Set(), seats: 0, handPlacedApprox: 0 };
  for (const cell of cells) {
    const row = rowById.get(cell.rowId);
    if (!row || !inScope.has(cell.columnId) || !clears(row, what) || cell.occupants.length === 0) continue;
    // Month scope: special columns keep their Coro and instruments — nothing refills them. Service scope clears everything.
    if (scope.kind === "month" && columnById.get(cell.columnId)?.type === "special_role" && cell.rowId !== "lead" && cell.rowId !== "bgv") continue;
    plan.cellKeys.add(keyOf(cell));
    plan.seats += cell.occupants.length;
    if (cell.origin === "manual") plan.handPlacedApprox += cell.occupants.length;
  }
  return plan;
}

/** Empties the planned cells and their waivers; every other cell survives by reference. */
export function applyClear(cells: GridCell[], plan: ClearPlan): GridCell[] {
  return cells.map((c) =>
    plan.cellKeys.has(keyOf(c)) ? { columnId: c.columnId, rowId: c.rowId, occupants: [], origin: "empty" as const } : c,
  );
}

/** «Deshacer»: re-applies ONLY the cleared cells' prior state onto the live array. */
export function restoreCleared(live: GridCell[], prior: GridCell[], columns: GridColumn[]): GridCell[] {
  const onGrid = new Set(columns.map((c) => c.columnId));
  const back = new Map(prior.filter((c) => onGrid.has(c.columnId)).map((c) => [keyOf(c), c]));
  const next = live.map((c) => back.get(keyOf(c)) ?? c);
  const present = new Set(live.map(keyOf));
  for (const [key, c] of back) if (!present.has(key)) next.push(c);
  return next;
}

/** A cleared cell is empty by the admin's choice, so its «Sin cubrir» markers go with it. */
export function dropClearedMarkers<T extends { columnId: string; rowId: string }>(markers: T[], plan: ClearPlan): T[] {
  return markers.filter((u) => !plan.cellKeys.has(keyOf(u)));
}
