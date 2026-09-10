// app/components/admin/__tests__/instrumentFill.test.ts
//
// The instrument filler (spec 2026-09-09 §6). Per-MEMBER total balance inside
// the month, per service, alternation on ties, empty seats only, and
// idempotence on its own output — the property round 2 of the review found
// missing when the vacate ran inside the column loop.
import { describe, expect, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import { buildRows, createColumnId, type GridCell, type GridColumn } from "../plannerModel";
import { fillInstruments, renderableUnfilled, isInstrumentRowId } from "../instrumentFill";

// March 2026: five Sundays, 1st..29th.
const SUNDAYS = ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"];
const col = (date: string, type: GridColumn["type"] = "sunday_role"): GridColumn =>
  ({ columnId: createColumnId(type, date), date, type });
const COLS = SUNDAYS.map((d) => col(d));
const ROWS = buildRows();
const KEYS = "instrumento:Keys";
const DRUMS = "instrumento:Drums";

const p = (id: string, name: string, instruments: string[], unavailable: string[] = []): RankMember =>
  ({ _id: id, member_name: name, memberType: ["instrumento"], instruments, unavailableDates: unavailable });

const cell = (columnId: string, rowId: string, ids: string[], origin: GridCell["origin"] = "manual"): GridCell =>
  ({ columnId, rowId, occupants: ids.map((memberId) => ({ memberId })), origin });

function run(members: RankMember[], cells: GridCell[] = [], columns = COLS) {
  return fillInstruments({ columns, rows: ROWS, cells, members, savedWindow: [] });
}
const occupantsOf = (cells: GridCell[], columnId: string, rowId: string) =>
  cells.find((c) => c.columnId === columnId && c.rowId === rowId)?.occupants.map((o) => o.memberId) ?? [];
const roster = (cells: GridCell[], rowId: string) => COLS.map((c) => occupantsOf(cells, c.columnId, rowId).join(","));
const countFor = (cells: GridCell[], id: string) =>
  cells.filter((c) => isInstrumentRowId(c.rowId)).flatMap((c) => c.occupants).filter((o) => o.memberId === id).length;

describe("fillInstruments — balance and alternation", () => {
  it("two drummers over five Sundays end within one of each other, alternating", () => {
    const out = run([p("a", "Ana", ["Drums"]), p("b", "Beto", ["Drums"])]);
    expect(roster(out.cells, DRUMS)).toEqual(["a", "b", "a", "b", "a"]);
    expect(Math.abs(countFor(out.cells, "a") - countFor(out.cells, "b"))).toBeLessThanOrEqual(1);
    expect(out.unfilled).toEqual([]);
  });

  it("three keys players: fewest-first, then alternation, then name", () => {
    const out = run([p("c", "Carla", ["Keys"]), p("a", "Ana", ["Keys"]), p("b", "Beto", ["Keys"])]);
    expect(roster(out.cells, KEYS)).toEqual(["a", "b", "c", "a", "b"]);
  });

  it("skips an unavailable player and breaks the bound only there", () => {
    const out = run([p("a", "Ana", ["Drums"], SUNDAYS.slice(2)), p("b", "Beto", ["Drums"])]);
    expect(roster(out.cells, DRUMS)).toEqual(["a", "b", "b", "b", "b"]);
  });

  it("counts a manual occupant and never replaces it", () => {
    const manual = cell(COLS[0].columnId, DRUMS, ["b"]);
    const out = run([p("a", "Ana", ["Drums"]), p("b", "Beto", ["Drums"])], [manual]);
    expect(occupantsOf(out.cells, COLS[0].columnId, DRUMS)).toEqual(["b"]);
    expect(out.cells.find((c) => c.columnId === COLS[0].columnId && c.rowId === DRUMS)).toBe(manual);
    // Beto already holds one, so Ana takes Sunday 2, then they alternate.
    expect(roster(out.cells, DRUMS)).toEqual(["b", "a", "b", "a", "b"]);
  });

  it("leaves a two-drummer cell alone (not empty, not touched)", () => {
    const two = cell(COLS[0].columnId, DRUMS, ["x", "y"]);
    const out = run([p("a", "Ana", ["Drums"])], [two]);
    expect(occupantsOf(out.cells, COLS[0].columnId, DRUMS)).toEqual(["x", "y"]);
  });

  it("a voice seat on the same column does NOT exclude (D4)", () => {
    const lead = cell(COLS[0].columnId, "lead", ["a"]);
    const out = run([{ ...p("a", "Ana", ["Keys"]), memberType: ["voz", "instrumento"] }], [lead]);
    expect(occupantsOf(out.cells, COLS[0].columnId, KEYS)).toEqual(["a"]);
  });

  it("never seats one member on two instrument rows of one column (same-category block)", () => {
    // X declares both; Y drums; Z keys. Drums is the thinner pool.
    const out = run([p("x", "Xavi", ["Keys", "Drums"]), p("y", "Yola", ["Drums"]), p("z", "Zoe", ["Keys"])]);
    for (const c of COLS) {
      const k = occupantsOf(out.cells, c.columnId, KEYS);
      const d = occupantsOf(out.cells, c.columnId, DRUMS);
      expect(k.filter((id) => d.includes(id))).toEqual([]);
    }
  });

  it("a two-instrument member goes to the thinner row, and totals balance as PEOPLE (spec §6.2 trace)", () => {
    const out = run([
      p("x", "Xavi", ["Keys", "Drums"]), p("y", "Yola", ["Drums"]),
      p("z", "Zoe", ["Keys"]), p("w", "Wendy", ["Keys"]),
    ]);
    expect(roster(out.cells, DRUMS)).toEqual(["x", "y", "x", "y", "x"]);
    expect(countFor(out.cells, "x")).toBe(3);
    expect(countFor(out.cells, "y")).toBe(2);
    // Keys never reaches Xavi: on the Sundays Xavi is free, Wendy or Zoe hold fewer seats.
    expect(roster(out.cells, KEYS).some((s) => s === "x")).toBe(false);
    const keysTotals = [countFor(out.cells, "z"), countFor(out.cells, "w")].sort();
    expect(keysTotals).toEqual([2, 3]);
  });
});

describe("fillInstruments — scope and markers", () => {
  it("skips a row nobody declares, with NO marker", () => {
    const out = run([p("a", "Ana", ["Drums"])]);
    expect(out.cells.some((c) => c.rowId === KEYS)).toBe(false);
    expect(out.unfilled.filter((u) => u.rowId === KEYS)).toEqual([]);
  });

  it("a leftover declaration on a member without the Tipo is not a declarer", () => {
    const out = run([{ ...p("a", "Ana", ["Drums"]), memberType: [] }]);
    expect(out.cells).toEqual([]);
    expect(out.unfilled).toEqual([]);
  });

  it("reports one unfilled entry per empty seat on a row that HAS declarers", () => {
    const out = run([p("a", "Ana", ["Keys"], SUNDAYS)]);
    expect(out.unfilled).toEqual(COLS.map((c) => ({ columnId: c.columnId, rowId: KEYS })));
    expect(out.cells).toEqual([]);
  });

  it("never fills a special column", () => {
    const special = col("2026-03-18", "special_role");
    const out = run([p("a", "Ana", ["Keys"])], [], [...COLS, special]);
    expect(out.cells.some((c) => c.columnId === special.columnId)).toBe(false);
    expect(out.unfilled.some((u) => u.columnId === special.columnId)).toBe(false);
  });

  it("fills Saturdays too, counting per service", () => {
    const sat = col("2026-03-07", "saturday_role");
    const out = run([p("a", "Ana", ["Drums"]), p("b", "Beto", ["Drums"])], [], [COLS[0], sat, COLS[1]]);
    // Sun 1 → Ana; Sat 7 → Beto (fewest); Sun 8 → Ana.
    expect(occupantsOf(out.cells, COLS[0].columnId, DRUMS)).toEqual(["a"]);
    expect(occupantsOf(out.cells, sat.columnId, DRUMS)).toEqual(["b"]);
    expect(occupantsOf(out.cells, COLS[1].columnId, DRUMS)).toEqual(["a"]);
  });

  it("stamps its picks origin auto and preserves untouched cells by reference", () => {
    const foh = cell(COLS[0].columnId, "foh:Console", ["s"]);
    const out = run([p("a", "Ana", ["Keys"])], [foh]);
    expect(out.cells).toContain(foh);
    expect(out.cells.find((c) => c.rowId === KEYS)?.origin).toBe("auto");
  });

  it("never fills a legacy-spelled stored row whose id does not match the canonical seat (review finding 1)", () => {
    // A role document stored `instrument: "keys"` before it was normalized to
    // "Keys"; stored-mode row-building keeps the case as written, so the row
    // reads `{ id: "instrumento:keys", label: "keys" }` — case-insensitively a
    // known instrument, but `instrumentSeatDef("keys").id` is `instrumento:Keys`,
    // not `instrumento:keys`. Filling it would double-seat one instrument
    // under a non-canonical id/label.
    const legacyRow = { id: "instrumento:keys", label: "keys", category: "instrumento" as const, target: 1 };
    const out = fillInstruments({
      columns: COLS,
      rows: [...ROWS, legacyRow],
      cells: [cell(COLS[0].columnId, legacyRow.id, [])],
      members: [p("a", "Ana", ["Keys"])],
      savedWindow: [],
    });
    expect(out.cells.some((c) => c.rowId === legacyRow.id && c.occupants.length > 0)).toBe(false);
    expect(out.unfilled.some((u) => u.rowId === legacyRow.id)).toBe(false);
    // The canonical row still fills.
    expect(occupantsOf(out.cells, COLS[0].columnId, KEYS)).toEqual(["a"]);
  });
});

describe("fillInstruments — re-run semantics", () => {
  it("is idempotent on its own output (the review's case: one drummer away three of five Sundays)", () => {
    const members = [p("a", "Ana", ["Drums"], SUNDAYS.slice(2)), p("b", "Beto", ["Drums"])];
    const first = run(members);
    const second = run(members, first.cells);
    expect(roster(second.cells, DRUMS)).toEqual(roster(first.cells, DRUMS));
    expect(second.unfilled).toEqual(first.unfilled);
  });

  it("vacates every auto pick before counting — stale picks in later columns do not steer earlier ones", () => {
    // Previous run left Beto on Sundays 2..5 (auto). A fresh run must produce
    // the same roster it would from an empty grid: a,b,a,b,a.
    const stale = COLS.slice(1).map((c) => cell(c.columnId, DRUMS, ["b"], "auto"));
    const out = run([p("a", "Ana", ["Drums"]), p("b", "Beto", ["Drums"])], stale);
    expect(roster(out.cells, DRUMS)).toEqual(["a", "b", "a", "b", "a"]);
  });

  it("re-rolls its own picks but keeps a manual one", () => {
    const stale = cell(COLS[0].columnId, DRUMS, ["b"], "auto");
    const manual = cell(COLS[1].columnId, DRUMS, ["b"], "manual");
    const out = run([p("a", "Ana", ["Drums"]), p("b", "Beto", ["Drums"])], [stale, manual]);
    expect(occupantsOf(out.cells, COLS[1].columnId, DRUMS)).toEqual(["b"]);
    expect(occupantsOf(out.cells, COLS[0].columnId, DRUMS)).toEqual(["a"]);
  });

  it("leaves an auto instrument cell on a SPECIAL column untouched by the vacate (by reference)", () => {
    const special = col("2026-03-18", "special_role");
    const specialAuto = cell(special.columnId, DRUMS, ["b"], "auto");
    const out = run([p("a", "Ana", ["Drums"])], [specialAuto], [...COLS, special]);
    expect(out.cells).toContain(specialAuto);
    expect(occupantsOf(out.cells, special.columnId, DRUMS)).toEqual(["b"]);
  });
});

describe("renderableUnfilled", () => {
  it("drops an instrument entry whose cell now has an occupant, keeps everything else", () => {
    const u = [
      { columnId: COLS[0].columnId, rowId: KEYS },
      { columnId: COLS[1].columnId, rowId: KEYS },
      { columnId: COLS[0].columnId, rowId: "coro" },
      { columnId: COLS[0].columnId, rowId: "coro" },
    ];
    const cells = [cell(COLS[0].columnId, KEYS, ["a"]), cell(COLS[0].columnId, "coro", ["z"])];
    expect(renderableUnfilled(u, cells)).toEqual([u[1], u[2], u[3]]);
  });
});
