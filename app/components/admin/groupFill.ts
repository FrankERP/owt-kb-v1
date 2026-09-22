// app/components/admin/groupFill.ts
//
// The stored-mode GROUP fill for special services (spec
// 2026-09-22-camp-group-fill-design.md). Not the solver, and never described as
// one: it runs the two existing local fillers — `fillColumn` for Lead/BGV and
// `fillInstruments` for instrument rows — on the GROUP'S CELLS ALONE, with
// `columns = group` and `savedWindow = []`. That scoping is the whole feature:
// inside the fill, the only load that exists is appearances inside the group, so
// a camp rotates among whoever goes and the month's weekends weigh nothing.
//
// Empty seats only. Every occupant already in a group cell — a pin — is kept and
// counts toward group load; nothing is vacated. Cells outside the group are
// returned by reference.

import { compareServiceTime } from "@/app/utils/serviceTime";
import type { RankMember } from "./candidateRanking";
import { fillInstruments } from "./instrumentFill";
import { fillColumn } from "./localFill";
import type { GridCell, GridColumn, GridRow, SolverConfig } from "./plannerModel";

type Seat = { columnId: string; rowId: string };

/** Set order: date, then clock time (absent last), then id for determinism. */
export function orderGroup(group: GridColumn[]): GridColumn[] {
  return [...group].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      compareServiceTime(a.time, b.time) ||
      a.columnId.localeCompare(b.columnId),
  );
}

const key = (c: Pick<GridCell, "columnId" | "rowId">) => `${c.columnId}\u0000${c.rowId}`;

export function fillSpecialGroup(input: {
  group: GridColumn[];
  rows: GridRow[];
  cells: GridCell[];
  members: RankMember[];
  config: SolverConfig;
}): { cells: GridCell[]; unfilled: Seat[] } {
  const group = orderGroup(input.group.filter((c) => c.type === "special_role"));
  if (group.length === 0) return { cells: input.cells, unfilled: [] };

  const ids = new Set(group.map((c) => c.columnId));
  let working = input.cells.filter((c) => ids.has(c.columnId));
  const unfilled: Seat[] = [];

  for (const column of group) {
    const out = fillColumn({
      column,
      columns: group,
      rows: input.rows,
      cells: working,
      members: input.members,
      savedWindow: [],
      config: input.config,
    });
    working = out.cells;
    unfilled.push(...out.unfilled);
  }

  const instr = fillInstruments({
    columns: group,
    fillColumns: group,
    rows: input.rows,
    cells: working,
    members: input.members,
    savedWindow: [],
    config: input.config,
  });
  working = instr.cells;
  unfilled.push(...instr.unfilled);

  // Merge: group cells replace their originals in place; new group cells append.
  const filled = new Map(working.map((c) => [key(c), c]));
  const merged = input.cells.map((c) => {
    if (!ids.has(c.columnId)) return c;
    const next = filled.get(key(c));
    filled.delete(key(c));
    return next ?? c;
  });
  return { cells: [...merged, ...filled.values()], unfilled };
}
