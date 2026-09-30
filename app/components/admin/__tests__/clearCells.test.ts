import { describe, expect, it } from "vitest";

import { buildColumns, buildRows, createColumnId, type GridCell } from "../plannerModel";
import { applyClear, dropClearedMarkers, planClear, restoreCleared } from "../clearCells";

const cols = buildColumns({ sundayDates: ["2026-03-01", "2026-03-08"], activeSatDates: [], specials: [{ date: "2026-03-04", name: "Vigilia" }] });
const rows = buildRows();
const SUN1 = createColumnId("sunday_role", "2026-03-01");
const SUN2 = createColumnId("sunday_role", "2026-03-08");
const SPECIAL = createColumnId("special_role", "2026-03-04");
const cell = (columnId: string, rowId: string, ids: string[], origin: GridCell["origin"] = "auto", extra: Partial<GridCell> = {}): GridCell =>
  ({ columnId, rowId, occupants: ids.map((memberId) => ({ memberId })), origin, ...extra });

const board: GridCell[] = [
  cell(SUN1, "lead", ["ana"], "manual", { overrides: ["ana"], overrideReasons: { ana: "Regla: x" } }),
  cell(SUN1, "coro", ["lu", "beto"]),
  cell(SUN1, "instrumento:Drums", ["paco"]),
  cell(SUN1, "foh:Console", ["zoe"], "manual"),
  cell(SUN2, "bgv", ["beto"], "manual"),
  cell(SPECIAL, "lead", ["ana"]),
];

describe("planClear", () => {
  it("scopes to one service and counts its seats, never FOH", () => {
    const voices = planClear({ cells: board, rows, columns: cols, scope: { kind: "service", columnId: SUN1 }, what: "voices" });
    expect([...voices.cellKeys]).toEqual([`${SUN1}|lead`, `${SUN1}|coro`]);
    expect(voices.seats).toBe(3);
    expect(voices.handPlacedApprox).toBe(1);
    expect(planClear({ cells: board, rows, columns: cols, scope: { kind: "service", columnId: SUN1 }, what: "instruments" }).seats).toBe(1);
    expect(planClear({ cells: board, rows, columns: cols, scope: { kind: "service", columnId: SUN1 }, what: "both" }).seats).toBe(4);
  });

  it("covers every column of the month, specials included", () => {
    const month = planClear({ cells: board, rows, columns: cols, scope: { kind: "month" }, what: "voices" });
    expect(month.seats).toBe(5);
    expect(month.handPlacedApprox).toBe(2);
  });
});

describe("applyClear / restoreCleared / dropClearedMarkers", () => {
  const plan = planClear({ cells: board, rows, columns: cols, scope: { kind: "service", columnId: SUN1 }, what: "voices" });

  it("empties exactly the planned cells and their waivers, leaving every other cell by reference", () => {
    const next = applyClear(board, plan);
    expect(next[0]).toEqual({ columnId: SUN1, rowId: "lead", occupants: [], origin: "empty" });
    expect(next[1]).toEqual({ columnId: SUN1, rowId: "coro", occupants: [], origin: "empty" });
    for (const i of [2, 3, 4, 5]) expect(next[i]).toBe(board[i]);
  });

  it("puts back only the cleared cells' prior state onto the live array", () => {
    const cleared = applyClear(board, plan);
    const live = cleared.map((c) => (c.columnId === SUN2 && c.rowId === "bgv" ? { ...c, occupants: [{ memberId: "ana" }] } : c));
    const prior = board.filter((c) => plan.cellKeys.has(`${c.columnId}|${c.rowId}`));
    const restored = restoreCleared(live, prior, cols);
    expect(restored.find((c) => c.columnId === SUN1 && c.rowId === "lead")).toEqual(board[0]);
    expect(restored.find((c) => c.columnId === SUN2 && c.rowId === "bgv")?.occupants).toEqual([{ memberId: "ana" }]);
  });

  it("never restores a cell whose column is no longer on the grid", () => {
    const prior = board.filter((c) => plan.cellKeys.has(`${c.columnId}|${c.rowId}`));
    expect(restoreCleared([], prior, [])).toEqual([]);
  });

  it("drops the unfilled markers of the cleared cells only", () => {
    const markers = [{ columnId: SUN1, rowId: "coro" }, { columnId: SUN1, rowId: "coro" }, { columnId: SUN2, rowId: "lead" }];
    expect(dropClearedMarkers(markers, plan)).toEqual([{ columnId: SUN2, rowId: "lead" }]);
  });
});
