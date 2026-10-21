// MCP proposal editor plan T2.3 (3): `draftsToCells` is `cellsToDrafts`' inverse over
// `buildRows()`, so a stored proposal's drafts become the grid's cells and back with every seat in
// order — and a draft the rows cannot hold is refused, never half-read.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildRows, cellsToDrafts, draftsToCells, type DraftCard } from "../plannerModel";
import { planV3Month } from "@/app/utils/v3MonthPlan";
import { deps } from "@/app/utils/__tests__/v3MonthPlanFixtures";

const seats = (d: DraftCard) => ({ leads: d.leads, bgvs: d.bgvs, chorus: d.chorus, instruments: d.instruments, foh: d.foh });

async function recorded(months: 1 | 2): Promise<DraftCard[]> {
  const out = await planV3Month(
    { month: "2026-11", months, specials: [{ date: "2026-11-18", name: "Noche de alabanza" }] },
    deps(),
  );
  if (out.kind !== "success") throw new Error(`expected a plan, got ${out.kind}`);
  // The fixture's pool holds no instrumentalists, so one Sunday gets instrument and FOH seats by
  // hand: two drummers on one seat (the team's real shape, `seatModel.ts`) and a console.
  const drafts = out.plan.drafts.map((d) => d.draft);
  const i = drafts.findIndex((d) => d._type === "sunday_role");
  drafts[i] = {
    ...drafts[i],
    instruments: [
      { id: "instrumento:Bass#0", instrument: "Bass", personId: "m-bass" },
      { id: "instrumento:Drums#0", instrument: "Drums", personId: "m-drums-1" },
      { id: "instrumento:Drums#1", instrument: "Drums", personId: "m-drums-2" },
    ],
    foh: [{ id: "foh:Console#0", role: "Console", personId: "m-console" }],
  };
  return drafts;
}

describe("draftsToCells", () => {
  it.each([1, 2] as const)("round-trips every draft of a recorded %i-month board, seats in order", async (months) => {
    const drafts = await recorded(months);
    expect(drafts.some((d) => d.leads.length + d.bgvs.length > 0)).toBe(true);
    expect(drafts.some((d) => d.instruments.length > 0)).toBe(true);
    const rows = buildRows();
    const board = draftsToCells(drafts, rows);
    if (!board) throw new Error("expected a board");
    const back = cellsToDrafts(board.cells, board.columns, new Set(), drafts, []);
    expect(back.map(seats)).toEqual(drafts.map(seats));
    expect(back.map((d) => [d.localId, d._type, d.date, d.service_name, d.countsForFairness]))
      .toEqual(drafts.map((d) => [d.localId, d._type, d.date, d.service_name, d.countsForFairness]));
  });

  it("refuses a seat with no row, a Coro on a Saturday, and two drafts on one date", async () => {
    const drafts = await recorded(1);
    const rows = buildRows();
    const sunday = drafts.find((d) => d._type === "sunday_role")!;
    const saturday = drafts.find((d) => d._type === "saturday_role")!;
    expect(draftsToCells([{ ...sunday, instruments: [{ id: "x#0", instrument: "Theremin", personId: "m1" }] }], rows)).toBeNull();
    expect(draftsToCells([{ ...saturday, chorus: ["m1"] }], rows)).toBeNull();
    expect(draftsToCells([sunday, { ...sunday, localId: "other" }], rows)).toBeNull();
  });
});
