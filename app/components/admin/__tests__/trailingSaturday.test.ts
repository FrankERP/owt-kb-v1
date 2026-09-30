// app/components/admin/__tests__/trailingSaturday.test.ts
//
// T1 (delivery 2, plan 2026-09-30-planner-trailing-saturday): the month-end Saturday whose
// Sunday falls in the NEXT month — Sat 31 Oct 2026 — is solver week `weeks + 1`. One pure
// definition, `trailingSaturday`, and every adjacency helper resolves that date through it,
// so a column, a seat, an unfilled marker and a pin can never disagree about its week. A
// month without one (Nov 2026) must answer exactly as it did before.
import { describe, expect, it } from "vitest";

import type { SolveResponse } from "@/app/api/admin/solve/route";
import type { RankMember } from "../candidateRanking";
import {
  applySolveResponse,
  buildColumns,
  buildRows,
  cellsToDrafts,
  createColumnId,
  mapUnfilledSeats,
  saturdayForWeek,
  trailingSaturday,
  weekForColumn,
  weekendWeekIndexes,
  type GridCell,
} from "../plannerModel";
import { collectPins, emptyVoiceSeats } from "../pinModel";

// October 2026: Sundays 4/11/18/25; Saturday 31 is the eve of Sunday 1 Nov.
const OCT = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];
// November 2026: Sundays 1/8/15/22/29; 29 + 6 is 5 Dec, so no trailing Saturday.
const NOV = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"];
const NOV_SATS = ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"];

const TIPO = ["voz", "sunday_lead", "saturday_lead", "support"];
const m = (id: string, member_name: string): RankMember => ({ _id: id, member_name, memberType: TIPO } as RankMember);
const ANA = m("ana", "Ana Karen Villalobos");
const BETO = m("beto", "Alberto Ruiz Cano");
const LU = m("lu", "María Lucía Estrada");
const members = [ANA, BETO, LU];
const rows = buildRows();

const SAT3 = createColumnId("saturday_role", "2026-10-03");
const SAT31 = createColumnId("saturday_role", "2026-10-31");
const SUN4 = createColumnId("sunday_role", "2026-10-04");

const cell = (columnId: string, rowId: string, ids: string[]): GridCell => ({
  columnId, rowId, occupants: ids.map((memberId) => ({ memberId })), origin: "manual",
});

const response = (schedule: SolveResponse["schedule"]): SolveResponse => ({
  ok: true, schedule, unfilled_seats: [],
});

describe("trailingSaturday", () => {
  it("is the last Sunday + 6 days when that is still in the month", () => {
    expect(trailingSaturday(OCT)).toBe("2026-10-31");
    expect(trailingSaturday(["2026-01-04", "2026-01-11", "2026-01-18", "2026-01-25"])).toBe("2026-01-31");
    expect(trailingSaturday(["2026-02-01", "2026-02-08", "2026-02-15", "2026-02-22"])).toBe("2026-02-28");
    expect(trailingSaturday(["2027-07-04", "2027-07-11", "2027-07-18", "2027-07-25"])).toBe("2027-07-31");
  });

  it("is null when that Saturday falls in the next month, and for an empty spine", () => {
    expect(trailingSaturday(NOV)).toBeNull();
    expect(trailingSaturday([])).toBeNull();
  });
});

describe("the adjacency helpers resolve the trailing Saturday to week weeks + 1", () => {
  it("saturdayForWeek", () => {
    expect(saturdayForWeek(5, OCT)).toBe("2026-10-31");
    expect(saturdayForWeek(6, OCT)).toBeNull();
    expect(saturdayForWeek(1, OCT)).toBe("2026-10-03");
  });

  it("weekForColumn", () => {
    expect(weekForColumn({ type: "saturday_role", date: "2026-10-31" }, OCT)).toBe(5);
    expect(weekForColumn({ type: "saturday_role", date: "2026-10-03" }, OCT)).toBe(1);
    // Only a Saturday column: a special or a Sunday on that date is not week 5.
    expect(weekForColumn({ type: "special_role", date: "2026-10-31" }, OCT)).toBeNull();
    expect(weekForColumn({ type: "sunday_role", date: "2026-10-31" }, OCT)).toBeNull();
  });

  it("weekendWeekIndexes lists it as a candidate when it is selected", () => {
    expect(weekendWeekIndexes(OCT, ["2026-10-31"])).toEqual([5]);
    expect(weekendWeekIndexes(OCT, ["2026-10-03", "2026-10-31"])).toEqual([1, 5]);
    expect(weekendWeekIndexes(OCT, ["2026-10-03"])).toEqual([1]);
  });

  it("applySolveResponse writes week 5's Saturday (no Sunday key) onto the 31st and touches nothing else", () => {
    const columns = buildColumns({ sundayDates: OCT, activeSatDates: ["2026-10-03", "2026-10-31"] });
    const previousCells = [
      cell(SUN4, "lead", ["lu"]),
      cell(SAT3, "bgv", ["beto"]),
      cell(SAT31, "instrumento:Drums", ["lu"]),
    ];
    const result = applySolveResponse({
      response: response({ "5": { Saturday: { Lead: ["Ana Karen Villalobos"], BGV: ["Alberto Ruiz Cano"] } } }),
      previousCells, columns, rows, sundayDates: OCT, activeSatDates: ["2026-10-03", "2026-10-31"], members,
    });
    const at = (columnId: string, rowId: string) => result.cells.find((c) => c.columnId === columnId && c.rowId === rowId);
    expect(at(SAT31, "lead")).toEqual({ columnId: SAT31, rowId: "lead", occupants: [{ memberId: "ana" }], origin: "auto" });
    expect(at(SAT31, "bgv")).toEqual({ columnId: SAT31, rowId: "bgv", occupants: [{ memberId: "beto" }], origin: "auto" });
    // Everything else survives byte for byte, and nothing else was minted.
    expect(result.cells.filter((c) => !(c.columnId === SAT31 && (c.rowId === "lead" || c.rowId === "bgv"))))
      .toEqual(previousCells);
    expect(result.unresolvedNames).toEqual([]);
  });

  it("mapUnfilledSeats places a week-5 Saturday seat on the 31st", () => {
    expect(mapUnfilledSeats(["W5 Saturday Sat.BGV #3"], OCT, ["2026-10-31"], OCT)).toEqual([
      { columnId: SAT31, rowId: "bgv" },
    ]);
    // Still filtered by the selection, like every Saturday.
    expect(mapUnfilledSeats(["W5 Saturday Sat.BGV #3"], OCT, ["2026-10-03"], OCT)).toEqual([]);
  });

  it("cellsToDrafts carries the solved voices into the 31st's saturday_role draft", () => {
    const columns = buildColumns({ sundayDates: OCT, activeSatDates: ["2026-10-31"] });
    const { cells } = applySolveResponse({
      response: response({ "5": { Saturday: { Lead: ["Ana Karen Villalobos"], BGV: ["Alberto Ruiz Cano", "María Lucía Estrada"] } } }),
      previousCells: [], columns, rows, sundayDates: OCT, activeSatDates: ["2026-10-31"], members,
    });
    const draft = cellsToDrafts(cells, columns, new Set(), [], []).find((d) => d.date === "2026-10-31");
    expect(draft).toMatchObject({
      _type: "saturday_role", date: "2026-10-31", skipped: false,
      leads: ["ana"], bgvs: ["beto", "lu"], chorus: [],
    });
  });
});

describe("Q1: a Saturday the request does not send is not a column Auto writes", () => {
  const columns = buildColumns({ sundayDates: OCT, activeSatDates: ["2026-10-03", "2026-10-31"] });
  const cells = [cell(SAT3, "lead", ["ana"]), cell(SAT31, "lead", ["beto"]), cell(SAT31, "bgv", ["lu"])];

  it("collectPins skips the 31st when week 5 is not sent, and pins it as week 5 when it is", () => {
    const withheld = collectPins({ cells, columns, rows, members, sundayDates: OCT, weekendsWithSaturday: [1] });
    expect(withheld.pins).toEqual([{ week: 1, role: "Sat.Lead", person: "Ana Karen Villalobos" }]);
    expect([...withheld.pinnedCellKeys]).toEqual([`${SAT3}|lead`]);

    const none = collectPins({ cells, columns, rows, members, sundayDates: OCT, weekendsWithSaturday: [] });
    expect(none.pins).toEqual([]);

    const sent = collectPins({ cells, columns, rows, members, sundayDates: OCT, weekendsWithSaturday: [1, 5] });
    expect(sent.pins).toEqual([
      { week: 1, role: "Sat.Lead", person: "Ana Karen Villalobos" },
      { week: 5, role: "Sat.Lead", person: "Alberto Ruiz Cano" },
      { week: 5, role: "Sat.BGV", person: "María Lucía Estrada" },
    ]);
  });

  it("collectPins without weekendsWithSaturday filters nothing (today's behaviour)", () => {
    const absent = collectPins({ cells, columns, rows, members, sundayDates: OCT });
    expect(absent.pins.map((p) => p.week)).toEqual([1, 5, 5]);
  });

  it("emptyVoiceSeats leaves out the 31st's seats when week 5 is not sent", () => {
    const satSeats = rows.filter((r) => r.id === "lead" || r.id === "bgv").reduce((n, r) => n + (r.target ?? 0), 0);
    const sent = emptyVoiceSeats({ cells: [], columns, rows, sundayDates: OCT, weekendsWithSaturday: [1, 5] });
    const withheld = emptyVoiceSeats({ cells: [], columns, rows, sundayDates: OCT, weekendsWithSaturday: [1] });
    const absent = emptyVoiceSeats({ cells: [], columns, rows, sundayDates: OCT });
    expect(sent - withheld).toBe(satSeats);
    expect(absent).toBe(sent);
  });
});

describe("a month with no trailing Saturday (Nov 2026) answers exactly as before", () => {
  it("saturdayForWeek, weekForColumn and weekendWeekIndexes", () => {
    expect(saturdayForWeek(1, NOV)).toBe("2026-10-31"); // the eve of Sunday 1 Nov, as always
    expect(saturdayForWeek(5, NOV)).toBe("2026-11-28");
    expect(saturdayForWeek(6, NOV)).toBeNull();
    expect(saturdayForWeek(0, NOV)).toBeNull();
    expect(weekForColumn({ type: "saturday_role", date: "2026-11-07" }, NOV)).toBe(2);
    expect(weekForColumn({ type: "saturday_role", date: "2026-11-28" }, NOV)).toBe(5);
    expect(weekForColumn({ type: "saturday_role", date: "2026-12-05" }, NOV)).toBeNull();
    expect(weekendWeekIndexes(NOV, NOV_SATS)).toEqual([2, 3, 4, 5]);
  });

  it("applySolveResponse and mapUnfilledSeats have no week 6", () => {
    const columns = buildColumns({ sundayDates: NOV, activeSatDates: NOV_SATS });
    const result = applySolveResponse({
      response: response({ "6": { Saturday: { Lead: ["Ana Karen Villalobos"], BGV: [] } } }),
      previousCells: [], columns, rows, sundayDates: NOV, activeSatDates: NOV_SATS, members,
    });
    expect(result.cells).toEqual([]);
    expect(mapUnfilledSeats(["W6 Saturday Sat.BGV #1"], NOV, NOV_SATS, NOV)).toEqual([]);
    expect(mapUnfilledSeats(["W5 Saturday Sat.BGV #1"], NOV, NOV_SATS, NOV)).toEqual([
      { columnId: createColumnId("saturday_role", "2026-11-28"), rowId: "bgv" },
    ]);
  });

  it("collectPins pins a Saturday the same with or without the week list", () => {
    const columns = buildColumns({ sundayDates: NOV, activeSatDates: ["2026-11-28"] });
    const cells = [cell(createColumnId("saturday_role", "2026-11-28"), "lead", ["ana"])];
    const expected = [{ week: 5, role: "Sat.Lead", person: "Ana Karen Villalobos" }];
    expect(collectPins({ cells, columns, rows, members, sundayDates: NOV }).pins).toEqual(expected);
    expect(collectPins({ cells, columns, rows, members, sundayDates: NOV, weekendsWithSaturday: [5] }).pins)
      .toEqual(expected);
  });
});
