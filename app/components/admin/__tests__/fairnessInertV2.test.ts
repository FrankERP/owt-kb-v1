// Solver v3 C1-R12 — v2 is inert to «Cuenta para equidad». The v2 solve request
// takes no columns at all, and the local fairness-history entry is a function of
// the drafts' seats and types only: flipping every toggle changes neither.
import { describe, expect, expectTypeOf, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import { applyCreateCountsEdits } from "../fairnessToggleModel";
import {
  buildColumns,
  buildSolveRequest,
  cellsToDrafts,
  historyEntryFromDrafts,
  type GridCell,
  type GridColumn,
  type SolverConfig,
} from "../plannerModel";

const TODAY = "2026-11-02"; // November 2026 is the current month: no column below is past.
const SUNDAYS = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"];
const SATURDAYS = ["2026-11-07", "2026-11-14"];
const MEMBERS: RankMember[] = [
  { _id: "m-ana", member_name: "Ana", memberType: ["voz"] },
  { _id: "m-beto", member_name: "Beto", memberType: ["voz"] },
  { _id: "m-caro", member_name: "Caro", memberType: ["voz"] },
];
const CONFIG: SolverConfig = {
  sundayLeads: ["m-ana"],
  saturdayLeads: ["m-beto"],
  support: ["m-caro"],
  restrictions: [],
  conflicts: [],
  presence: [],
};

function columnsWithEvery(value: boolean): GridColumn[] {
  const base = buildColumns({
    sundayDates: SUNDAYS,
    activeSatDates: SATURDAYS,
    specials: [{ date: "2026-11-11", name: "Vigilia" }],
  });
  return applyCreateCountsEdits(base, new Map(base.map((c) => [c.columnId, value])), TODAY);
}

function cellsFor(columns: GridColumn[]): GridCell[] {
  return columns.flatMap((column): GridCell[] => [
    { columnId: column.columnId, rowId: "lead", occupants: [{ memberId: "m-ana" }], origin: "manual" },
    { columnId: column.columnId, rowId: "bgv", occupants: [{ memberId: "m-beto" }], origin: "manual" },
    {
      columnId: column.columnId,
      rowId: "coro",
      occupants: column.type === "saturday_role" ? [] : [{ memberId: "m-caro" }],
      origin: "manual",
    },
  ]);
}

describe("v2 is inert to countsForFairness (solver v3 C1-R12)", () => {
  it("the two column sets really differ: every toggle on versus every toggle off", () => {
    expect(columnsWithEvery(true).every((c) => c.countsForFairness)).toBe(true);
    expect(columnsWithEvery(false).every((c) => !c.countsForFairness)).toBe(true);
  });

  it("historyEntryFromDrafts is identical with every toggle on and every toggle off", () => {
    const on = columnsWithEvery(true);
    const off = columnsWithEvery(false);
    const draftsOn = cellsToDrafts(cellsFor(on), on, new Set(), [], []);
    const draftsOff = cellsToDrafts(cellsFor(off), off, new Set(), [], []);
    expect(draftsOn.map((d) => d.countsForFairness)).not.toEqual(draftsOff.map((d) => d.countsForFairness));
    expect(historyEntryFromDrafts(draftsOn, MEMBERS, 2026, 11)).toEqual(
      historyEntryFromDrafts(draftsOff, MEMBERS, 2026, 11),
    );
  });

  it("buildSolveRequest takes no columns, so no toggle can reach the v2 request", () => {
    expectTypeOf<Parameters<typeof buildSolveRequest>[0]>().not.toHaveProperty("columns");
    const input = {
      config: CONFIG,
      members: MEMBERS,
      sundayDates: SUNDAYS,
      activeSatDates: SATURDAYS,
      historyEntries: [],
      year: 2026,
      month: 11,
    };
    expect(buildSolveRequest(input)).toEqual(buildSolveRequest(input));
  });
});
