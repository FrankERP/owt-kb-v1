// app/components/admin/__tests__/groupFill.test.ts
//
// The stored-mode group fill (spec 2026-09-22-camp-group-fill-design.md §4):
// load counts inside the group only, empty seats only, weekends invisible.
import { describe, expect, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { buildRows, type GridCell, type GridColumn, type SolverConfig } from "../plannerModel";
import { fillSpecialGroup, orderGroup } from "../groupFill";

const ROWS = buildRows();
const KEYS = "instrumento:Keys";
const NO_RULES: SolverConfig = { ...DEFAULT_SOLVER_CONFIG, restrictions: [], conflicts: [], presence: [] };

const voz = (id: string, alias: string, unavailableDates: string[] = []): RankMember =>
  ({ _id: id, member_name: `${alias} Apellido`, alias, memberType: ["voz"], unavailableDates });
// Aliases sort in id order: a < b < … so a tie resolves to the lower letter.
const TEN = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => voz(id, id.toUpperCase()));

const special = (id: string, date: string, time?: string): GridColumn =>
  ({ columnId: id, date, type: "special_role", serviceName: `Set ${id}`, ...(time ? { time } : {}) });
const SUNDAY: GridColumn = { columnId: "sun", date: "2026-10-04", type: "sunday_role" };

const cell = (columnId: string, rowId: string, ids: string[], origin: GridCell["origin"] = "manual"): GridCell =>
  ({ columnId, rowId, occupants: ids.map((memberId) => ({ memberId })), origin });
const occ = (cells: GridCell[], columnId: string, rowId: string) =>
  cells.find((c) => c.columnId === columnId && c.rowId === rowId)?.occupants.map((o) => o.memberId) ?? [];
const voices = (cells: GridCell[], columnId: string) => [...occ(cells, columnId, "lead"), ...occ(cells, columnId, "bgv")];

function fill(group: GridColumn[], cells: GridCell[] = [], members: RankMember[] = TEN, config: SolverConfig = NO_RULES) {
  return fillSpecialGroup({ group, rows: ROWS, cells, members, config });
}

describe("orderGroup", () => {
  it("orders by date, then time (absent last), whatever the input order", () => {
    const late = special("x", "2026-10-03", "18:30");
    const early = special("y", "2026-10-03", "09:00");
    const untimed = special("z", "2026-10-03");
    const friday = special("w", "2026-10-02", "18:45");
    expect(orderGroup([untimed, late, friday, early]).map((c) => c.columnId)).toEqual(["w", "y", "x", "z"]);
  });
});

describe("fillSpecialGroup — separation", () => {
  it("ignores a full Sunday: members who serve on it are still picked first inside the group", () => {
    const sundayCells = [cell("sun", "lead", ["a", "b"]), cell("sun", "bgv", ["c", "d", "e"])];
    const set = special("s1", "2026-10-03", "09:00");
    const out = fill([set], sundayCells);
    expect(occ(out.cells, "s1", "lead")).toEqual(["a", "b"]);
    expect(occ(out.cells, "s1", "bgv")).toEqual(["c", "d", "e"]);
  });

  it("returns every cell outside the group by reference, untouched", () => {
    const sundayLead = cell("sun", "lead", ["a", "b"]);
    const out = fill([special("s1", "2026-10-03")], [sundayLead]);
    expect(out.cells.find((c) => c.columnId === "sun" && c.rowId === "lead")).toBe(sundayLead);
  });

  it("ignores non-special columns passed in the group", () => {
    const out = fill([SUNDAY]);
    expect(out.cells).toEqual([]);
    expect(out.unfilled).toEqual([]);
  });
});

describe("fillSpecialGroup — rotation", () => {
  const FIVE = ["09:00", "12:30", "14:45", "18:30", "20:45"].map((t, i) => special(`s${i}`, "2026-10-03", t));

  it("balances voice appearances inside the group to within one", () => {
    const out = fill(FIVE);
    const counts = TEN.map((m) => FIVE.filter((c) => voices(out.cells, c.columnId).includes(m._id)).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    for (const c of FIVE) expect(voices(out.cells, c.columnId)).toHaveLength(5);
  });

  it("fills in set order: the 09:00 set gets the first picks even when passed last", () => {
    const out = fill([FIVE[3], FIVE[0]]);
    expect(voices(out.cells, "s0").sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(voices(out.cells, "s3").sort()).toEqual(["f", "g", "h", "i", "j"]);
  });

  it("keeps a pinned occupant, and the pin counts toward group load", () => {
    const pinned = cell("s0", "lead", ["j"]);
    const out = fill([FIVE[0], FIVE[1]], [pinned]);
    expect(occ(out.cells, "s0", "lead")).toContain("j");
    expect(voices(out.cells, "s1")).not.toContain("j");
  });
});

describe("fillSpecialGroup — eligibility", () => {
  it("never picks an unavailable member or a wrong-Tipo member", () => {
    const set = special("s1", "2026-10-03");
    const members = [
      voz("a", "A", ["2026-10-03"]),
      ...TEN.slice(1),
      { _id: "keys", member_name: "Keys Player", alias: "K", memberType: ["instrumento"], instruments: ["Keys"] } as RankMember,
    ];
    const out = fill([set], [], members);
    expect(voices(out.cells, "s1")).not.toContain("a");
    expect(voices(out.cells, "s1")).not.toContain("keys");
  });

  it("never seats a forbidden pair in the same set", () => {
    const members = [voz("lu", "Lucía"), voz("ni", "Niza"), voz("p1", "Pepe"), voz("p2", "Quique"), voz("p3", "Rita"), voz("p4", "Sara")];
    const config: SolverConfig = { ...NO_RULES, conflicts: [{ id: "c", personA: "Lucía", personB: "Niza", pattern: "*.LeadBGV" }] };
    const sets = [special("s1", "2026-10-03", "09:00"), special("s2", "2026-10-03", "12:30")];
    const out = fill(sets, [], members, config);
    for (const s of sets) {
      const v = voices(out.cells, s.columnId);
      expect(v.includes("lu") && v.includes("ni")).toBe(false);
    }
  });
});

describe("fillSpecialGroup — worship night", () => {
  it("leaves a worship night's Lead empty for the admin and still fills its three BGVs", () => {
    const night: GridColumn = { ...special("s1", "2026-10-03", "20:45"), format: "worship_night" };
    const out = fill([night]);
    expect(occ(out.cells, "s1", "lead")).toEqual([]);
    expect(occ(out.cells, "s1", "bgv")).toHaveLength(3);
    // No target on Lead means no seat to report missing either.
    expect(out.unfilled.filter((u) => u.rowId === "lead")).toEqual([]);
  });
});

describe("fillSpecialGroup — instruments", () => {
  it("fills Keys on every set, alternating between two players inside the group", () => {
    const players: RankMember[] = [
      { _id: "k1", member_name: "Ana Teclas", alias: "Ana", memberType: ["instrumento"], instruments: ["Keys"] },
      { _id: "k2", member_name: "Beto Teclas", alias: "Beto", memberType: ["instrumento"], instruments: ["Keys"] },
    ];
    const sets = ["09:00", "12:30", "18:30"].map((t, i) => special(`s${i}`, "2026-10-03", t));
    const out = fill(sets, [], [...TEN, ...players]);
    expect(sets.map((s) => occ(out.cells, s.columnId, KEYS).join(","))).toEqual(["k1", "k2", "k1"]);
  });
});
