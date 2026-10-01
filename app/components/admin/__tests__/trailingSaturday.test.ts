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
  buildSolveRequest,
  cellsToDrafts,
  createColumnId,
  mapUnfilledSeats,
  omittedCapsNotices,
  saturdayForWeek,
  trailingNotice,
  trailingSaturday,
  weekForColumn,
  weekendWeekIndexes,
  type GridCell,
  type PersonRestriction,
  type RestrictionCap,
  type SolverConfig,
  type SolverHistoryEntry,
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

// ─── Task 2: what the request sends — T5, the availability rule, per-person floors ─────────
//
// T5: the trailing Saturday is sent only if someone in the Sunday-lead ∪ Saturday-lead pools
// can lead it. Availability: a member unavailable on it is kept off it, and nothing is derived
// from the next month's Sunday. T3/T4: a Saturday minimum is judged per person against the
// Saturdays actually sent, then against the Saturday seats those Saturdays hold.

const OCT_SATS = ["2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24"];
const OCT_ALL_SATS = [...OCT_SATS, "2026-10-31"];

/** A member whose rules name them by `alias`, as every seeded rule does (E11). */
const person = (id: string, member_name: string, alias: string, extra: Partial<RankMember> = {}): RankMember =>
  ({ _id: id, member_name, alias, memberType: TIPO, ...extra } as RankMember);

const floor = (value = 1, pattern = "Sat.*", op: RestrictionCap["op"] = "=="): RestrictionCap => ({
  id: `${pattern}${op}${value}`, pattern, op, value, relative: false, relOffset: 2,
});

const rule = (who: string, caps: RestrictionCap[] = [], extra: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id: `r-${who}`, person: who, excludedPatterns: [], fairness: "none", fairnessSlack: 0, weekExclusions: [], caps, ...extra,
});

function build(opts: {
  members: RankMember[];
  config: Partial<SolverConfig>;
  activeSatDates: string[];
  sundayDates?: string[];
  historyEntries?: SolverHistoryEntry[];
  month?: number;
}) {
  const built = buildSolveRequest({
    config: { sundayLeads: [], saturdayLeads: [], support: [], restrictions: [], conflicts: [], presence: [], ...opts.config },
    members: opts.members,
    sundayDates: opts.sundayDates ?? OCT,
    activeSatDates: opts.activeSatDates,
    historyEntries: opts.historyEntries ?? [],
    year: 2026,
    month: opts.month ?? 10,
  });
  if (!built.ok) throw new Error(`refused: ${built.reason}`);
  return built;
}

// Ruling Q6: number-neutral, so it is true whether the person reaches no Saturday or too few.
const UNREACHABLE_TAIL =
  "los sábados que Auto llena este mes no alcanzan para cumplirlo (por disponibilidad, exclusiones o rol).";

describe("October 2026, only the 31st selected (spec §2.4)", () => {
  const FRANK = person("frank", "Francisco Rocha", "Frank");
  // Unavailable on Sunday 1 Nov — the NEXT month's Sunday, which October must not read.
  const ANDY = person("andy", "Andrés Ortega", "Andy", { unavailableDates: ["2026-11-01"] });
  const TAY = person("tay", "Taylor Ruiz", "Tay", { unavailableDates: ["2026-10-31"] });
  const VALE = person("vale", "Valeria Soto", "Vale");
  const members = [FRANK, ANDY, TAY, VALE];
  const config: Partial<SolverConfig> = {
    sundayLeads: ["frank"],
    support: ["andy", "tay", "vale"],
    restrictions: [rule("Andy", [floor()]), rule("Tay", [floor()]), rule("Vale", [floor()])],
  };

  it("sends week 5, keeps Andy's and Vale's minimums, leaves Tay's out as unreachable and keeps Tay off the 31st", () => {
    const built = build({ members, config, activeSatDates: ["2026-10-31"] });
    expect(built.request.weekends_with_saturday).toEqual([5]);
    expect(built.trailing).toEqual({ date: "2026-10-31", sent: true });
    // The whole list: Tay's line is gone (its only clause was the floor), Tay is excluded
    // from week 5, and Andy's 1 Nov produces nothing — no `week 5 Sun.*`, no week 6.
    expect(built.request.dsl_rules).toEqual([
      "Andrés Ortega Sat.* == 1",
      "Valeria Soto Sat.* == 1",
      "Taylor Ruiz !in week 5 Sat.*",
    ]);
    expect(built.omittedCaps).toEqual([{ person: "Tay", cap: "Sat.* == 1", reason: "unreachable" }]);
    expect(omittedCapsNotices(built.omittedCaps)).toEqual([`No se aplicó «Sat.* == 1» a Tay: ${UNREACHABLE_TAIL}`]);
    expect(trailingNotice(built.trailing!)).toBeNull();
  });

  it("all five Saturdays selected: [1..5], and every minimum is kept (Tay still reaches four)", () => {
    const built = build({ members, config, activeSatDates: OCT_ALL_SATS });
    expect(built.request.weekends_with_saturday).toEqual([1, 2, 3, 4, 5]);
    expect(built.trailing).toEqual({ date: "2026-10-31", sent: true });
    expect(built.request.dsl_rules).toEqual([
      "Andrés Ortega Sat.* == 1",
      "Taylor Ruiz Sat.* == 1",
      "Valeria Soto Sat.* == 1",
      "Taylor Ruiz !in week 5 Sat.*",
    ]);
    expect(built.omittedCaps).toEqual([]);
  });

  it("a deselected trailing Saturday sends nothing new: no week 5, no rule for it, trailing null", () => {
    const built = build({ members, config, activeSatDates: OCT_SATS });
    expect(built.request.weekends_with_saturday).toEqual([1, 2, 3, 4]);
    expect(built.trailing).toBeNull();
    expect(built.request.dsl_rules).toEqual([
      "Andrés Ortega Sat.* == 1",
      "Taylor Ruiz Sat.* == 1",
      "Valeria Soto Sat.* == 1",
    ]);
    expect(built.omittedCaps).toEqual([]);
  });
});

describe("T3: a Saturday minimum is judged per person against the Saturdays sent", () => {
  const FRANK = person("frank", "Francisco Rocha", "Frank");
  const GABY = person("gaby", "Gabriela Díaz", "Gaby");
  const ANDY = person("andy", "Andrés Ortega", "Andy");
  const members = [FRANK, GABY, ANDY];
  const base = { sundayLeads: ["frank"], saturdayLeads: ["gaby"], support: ["andy"] };
  const judge = (r: PersonRestriction, activeSatDates = ["2026-10-31"]) =>
    build({ members, config: { ...base, restrictions: [r] }, activeSatDates }).omittedCaps;

  it("a Lead minimum is out of reach for someone in no lead pool", () => {
    expect(judge(rule("Andy", [floor(1, "Sat.Lead")]))).toEqual([{ person: "Andy", cap: "Sat.Lead == 1", reason: "unreachable" }]);
    expect(judge(rule("Gaby", [floor(1, "Sat.Lead")]))).toEqual([]);
    expect(judge(rule("Frank", [floor(1, "Sat.Lead")]))).toEqual([]); // a Sunday lead may lead a Saturday
  });

  it("a `!in` pattern covering the floor's roles puts it out of reach, legacy aliases included", () => {
    expect(judge(rule("Andy", [floor(1, "Sat.BGV")], { excludedPatterns: ["Sat.BGV"] }))).toHaveLength(1);
    expect(judge(rule("Andy", [floor(1, "Sat.BGV")], { excludedPatterns: ["BGV.*"] }))).toHaveLength(1);
    expect(judge(rule("Andy", [floor()], { excludedPatterns: ["*.*"] }))).toHaveLength(1);
    // A lead barred from BGV can still meet `Sat.*` by leading; a non-lead cannot.
    expect(judge(rule("Gaby", [floor()], { excludedPatterns: ["Sat.BGV"] }))).toEqual([]);
    expect(judge(rule("Andy", [floor()], { excludedPatterns: ["Sat.BGV"] }))).toHaveLength(1);
    // A Sunday-only exclusion keeps nobody off a Saturday.
    expect(judge(rule("Andy", [floor()], { excludedPatterns: ["Sun.*"] }))).toEqual([]);
  });

  it("a week exclusion counts only for its own week", () => {
    const week5 = rule("Andy", [floor()], { weekExclusions: [{ id: "w", week: 5, pattern: "Sat.*" }] });
    expect(judge(week5)).toEqual([{ person: "Andy", cap: "Sat.* == 1", reason: "unreachable" }]);
    expect(judge(week5, ["2026-10-03", "2026-10-31"])).toEqual([]); // week 1 is still reachable
    expect(judge(rule("Andy", [floor()], { weekExclusions: [{ id: "w", week: 4, pattern: "Sat.*" }] }))).toEqual([]);
  });

  it("a minimum above the Saturdays a person can reach is left out, even when they reach some", () => {
    expect(judge(rule("Andy", [floor(2)]))).toEqual([{ person: "Andy", cap: "Sat.* == 2", reason: "unreachable" }]);
    expect(judge(rule("Andy", [floor(2)]), ["2026-10-03", "2026-10-31"])).toEqual([]);
    // Relative: {weeks-2} is 2 in a 4-Sunday month, reported as the rules card shows it.
    const rel: RestrictionCap = { ...floor(0), relative: true, relOffset: 2 };
    expect(judge(rule("Andy", [rel]))).toEqual([{ person: "Andy", cap: "Sat.* == sem−2", reason: "unreachable" }]);
  });

  it("merges every rule that names the person, resolved the way the request resolves them", () => {
    const built = build({
      members,
      config: {
        ...base,
        // Two rules for Andy, one by alias and one by member_name: the second one's `!in`
        // is what makes the first one's floor unreachable.
        restrictions: [rule("Andy", [floor(1, "Sat.BGV")]), { ...rule("Andrés Ortega", [], { excludedPatterns: ["Sat.*"] }), id: "r2" }],
      },
      activeSatDates: ["2026-10-31"],
    });
    expect(built.omittedCaps).toEqual([{ person: "Andy", cap: "Sat.BGV == 1", reason: "unreachable" }]);
    expect(built.request.dsl_rules).toEqual(["Andrés Ortega !in Sat.*"]);
  });

  it("maximums always stay, and only the unreachable floor leaves the person's line", () => {
    const built = build({
      members,
      config: { ...base, restrictions: [rule("Andy", [floor(1, "Sat.Lead"), floor(1, "Sat.*", "<="), floor(1, "Sun.*")])] },
      activeSatDates: ["2026-10-31"],
    });
    expect(built.request.dsl_rules).toEqual(["Andrés Ortega Sat.* <= 1 & Sun.* == 1"]);
  });

  it("applies in a month with no trailing Saturday too (T3 generalises the month-level rule)", () => {
    const NOV_ANDY = person("andy", "Andrés Ortega", "Andy", { unavailableDates: ["2026-11-07"] });
    const built = build({
      members: [FRANK, GABY, NOV_ANDY],
      config: { ...base, restrictions: [rule("Andy", [floor()])] },
      sundayDates: NOV,
      activeSatDates: ["2026-11-07"],
      month: 11,
    });
    expect(built.request.weekends_with_saturday).toEqual([2]);
    expect(built.trailing).toBeNull();
    expect(built.omittedCaps).toEqual([{ person: "Andy", cap: "Sat.* == 1", reason: "unreachable" }]);
  });
});

describe("T4: minimums that do not all fit the Saturday seats", () => {
  // One Saturday sent (the 31st): 2 Lead + 3 BGV, and one seat per person. The six below are
  // support only, so they compete for the THREE BGV seats: the two Lead seats are for leads.
  // (Fix round 1, ruling Q10: these fixtures used to count all five seats for them, a check
  // the solver's own seats could not honour — it refused the whole month, Sundays included.)
  const names = ["Fer", "Ana", "Eli", "Beto", "Dani", "Caro"]; // config order is NOT name order
  const members = [person("lead", "Líder Uno", "Lider"), ...names.map((n) => person(n.toLowerCase(), `${n} Apellido`, n))];
  const config: Partial<SolverConfig> = {
    sundayLeads: ["lead"],
    support: names.map((n) => n.toLowerCase()),
    restrictions: names.map((n) => rule(n, [floor()])),
  };
  const satCount = (name: string, n: number, key = "2026-9", month = 9): SolverHistoryEntry => ({
    key, year: 2026, month, total_counts: { [name]: n }, role_counts: { [name]: { "Sat.BGV": n, "Sun.BGV": 7 } },
  });
  const capacity = (...who: string[]) => who.map((p) => ({ person: p, cap: "Sat.* == 1", reason: "capacity" }));

  it("six support `Sat.* == 1` on three BGV seats: with no history the order is by name, so the last three are left out", () => {
    // Was «one left out of six on five seats»: that kept five non-leads on three BGV seats.
    const built = build({ members, config, activeSatDates: ["2026-10-31"] });
    expect(built.request.weekends_with_saturday).toEqual([5]);
    // Kept by name: Ana, Beto, Caro. Left out: Dani, Eli, Fer — reported in config order.
    expect(built.omittedCaps).toEqual(capacity("Fer", "Eli", "Dani"));
    expect(built.request.dsl_rules.filter((r) => r.includes("Sat.* == 1"))).toEqual([
      "Ana Apellido Sat.* == 1", "Beto Apellido Sat.* == 1", "Caro Apellido Sat.* == 1",
    ]);
    expect(omittedCapsNotices(built.omittedCaps)).toEqual([
      "No caben todos los mínimos de sábado en los lugares de sábado de este mes, así que no se aplicó «Sat.* == 1» a Fer, Eli y Dani.",
    ]);
  });

  it("the people with the most Saturdays in the request's history are left out first; this month's own entry does not count", () => {
    // Order: the zero counts by name (Caro, Dani, Eli, Fer), then Ana (1), then Beto (2).
    // Three BGV seats go to Caro, Dani and Eli, so Ana and Beto — kept on name alone — are
    // left out for their history. Caro's 9 is this month's own run and does not count (D14).
    // (Was one left out, Beto: the old check counted five seats for support-only people.)
    const built = build({
      members, config, activeSatDates: ["2026-10-31"],
      historyEntries: [
        satCount("Beto Apellido", 2),
        { ...satCount("Ana Apellido", 1, "2026-8", 8), role_counts: { "Ana Apellido": { "Sat.Lead": 1 } } },
        satCount("Caro Apellido", 9, "2026-10", 10), // this month's own run: excluded (D14)
      ],
    });
    expect(built.omittedCaps).toEqual(capacity("Fer", "Ana", "Beto")); // config order
  });

  it("five support minimums on the 31st: only three BGV seats, so two are left out", () => {
    // Was «five minimums on five seats all fit»: all five were non-leads, and a non-lead
    // cannot take a Lead seat — the solver found no seat for two of them.
    const five = { ...config, restrictions: names.slice(0, 5).map((n) => rule(n, [floor()])) };
    expect(build({ members, config: five, activeSatDates: ["2026-10-31"] }).omittedCaps).toEqual(capacity("Fer", "Eli"));
  });

  it("a lead's `Sat.*` floor can use a Lead seat: 2 leads + 3 support all fit the 31st", () => {
    const people = ["Ana", "Beto", "Caro", "Dani", "Eli"].map((n) => person(n.toLowerCase(), `${n} Apellido`, n));
    const built = build({
      members: people,
      config: {
        sundayLeads: ["ana"], saturdayLeads: ["beto"], support: ["caro", "dani", "eli"],
        restrictions: ["Ana", "Beto", "Caro", "Dani", "Eli"].map((n) => rule(n, [floor()])),
      },
      activeSatDates: ["2026-10-31"],
    });
    expect(built.omittedCaps).toEqual([]);
  });

  it("Failure A: one lead and four support `Sat.* == 1` on the 31st — exactly one left out, by name", () => {
    const people = [person("frank", "Francisco Rocha", "Frank"), ...["Dani", "Beto", "Ana", "Caro"].map((n) => person(n.toLowerCase(), `${n} Apellido`, n))];
    const built = build({
      members: people,
      config: {
        sundayLeads: ["frank"], support: ["dani", "beto", "ana", "caro"],
        restrictions: ["Dani", "Beto", "Ana", "Caro"].map((n) => rule(n, [floor()])),
      },
      activeSatDates: ["2026-10-31"],
    });
    expect(built.request.weekends_with_saturday).toEqual([5]);
    expect(built.omittedCaps).toEqual(capacity("Dani"));
  });

  it("Failure B: seats are per Saturday, never pooled across the month", () => {
    // The 24th and the 31st sent. Ana–Dani can only take the 31st (away on the 24th); Zoe can
    // take either. Pooled, six BGV seats hold five people; per Saturday, the 31st holds three.
    // Dani — fourth of the 31st-only people by name — is left out, not Zoe, who sorts last
    // but still has the 24th.
    const away = { unavailableDates: ["2026-10-24"] };
    const people = [
      person("frank", "Francisco Rocha", "Frank"),
      ...["Ana", "Beto", "Caro", "Dani"].map((n) => person(n.toLowerCase(), `${n} Apellido`, n, away)),
      person("zoe", "Zoe Apellido", "Zoe"),
    ];
    const built = build({
      members: people,
      config: {
        sundayLeads: ["frank"], support: ["ana", "beto", "caro", "dani", "zoe"],
        restrictions: ["Zoe", "Dani", "Caro", "Beto", "Ana"].map((n) => rule(n, [floor()])),
      },
      activeSatDates: ["2026-10-24", "2026-10-31"],
    });
    expect(built.request.weekends_with_saturday).toEqual([4, 5]);
    expect(built.omittedCaps).toEqual(capacity("Dani"));
  });

  it("a person with two Saturday floors keeps only the first; the second is `combined`, before any seat", () => {
    // Ruling Q16: one Saturday floor per person is judged — the first reachable one in the
    // rules card's order (Q18) — and every other reachable one is `combined`. Lead one Saturday
    // and BGV the other would meet both of Ana's floors, and the solver could find that; the
    // planner does not look for it. Frank is a
    // second lead, so each Saturday has someone to lead it. (Fix round 2, M3: with Ana the only
    // lead, one of the two Saturdays had no lead at all, which the solver refuses regardless.)
    const people = [person("ana", "Ana Apellido", "Ana"), person("frank", "Francisco Rocha", "Frank")];
    const both = (caps: RestrictionCap[]) =>
      build({ members: people, config: { sundayLeads: ["ana", "frank"], restrictions: [rule("Ana", caps)] }, activeSatDates: ["2026-10-24", "2026-10-31"] });
    expect(both([floor(1, "Sat.Lead", ">="), floor(1, "Sat.BGV", ">=")]).omittedCaps).toEqual([
      { person: "Ana", cap: "Sat.BGV >= 1", reason: "combined" },
    ]);
    // Moved by Q16: was `[]`, when the two shared the Lead class and were merged and both kept.
    const twoLead = both([floor(1, "Sat.*"), floor(1, "Sat.Lead")]);
    expect(twoLead.omittedCaps).toEqual([{ person: "Ana", cap: "Sat.Lead == 1", reason: "combined" }]);
    expect(twoLead.request.dsl_rules).toEqual(["Ana Apellido Sat.* == 1"]);
  });

  it("I-A: Pau's `Sat.* == 2` and `Sat.Lead == 1` — the second is `combined`", () => {
    // The 24th and the 31st sent (November: the 21st and the 28th). Pau, a Sunday lead, has
    // `Sat.* == 2` and `Sat.Lead == 1`: really one Lead and one BGV, and the BGV seats are full
    // (A1–A3 on one Saturday, B1–B3 on the other). Merged into «two seats of a class both allow»
    // she was seated Lead twice and the model called it a fit; the solver refused the month
    // (ok: false). Same expectation as fix round 2, for a new reason (Q16): `Sat.Lead == 1` is
    // her second reachable floor, so it is `combined` — no merge rule is consulted. Frank, a
    // lead with no minimum, leads the other seat.
    const shapes = [
      { sundayDates: OCT, sats: ["2026-10-24", "2026-10-31"], month: 10 },
      { sundayDates: NOV, sats: ["2026-11-21", "2026-11-28"], month: 11 },
    ];
    for (const { sundayDates, sats, month } of shapes) {
      const a = ["A1", "A2", "A3"].map((n) => person(n.toLowerCase(), `${n} Apellido`, n, { unavailableDates: [sats[1]] }));
      const b = ["B1", "B2", "B3"].map((n) => person(n.toLowerCase(), `${n} Apellido`, n, { unavailableDates: [sats[0]] }));
      const built = build({
        members: [person("pau", "Paulina Reyes", "Pau"), person("frank", "Francisco Rocha", "Frank"), ...a, ...b],
        config: {
          sundayLeads: ["pau", "frank"],
          support: [...a, ...b].map((p) => p._id),
          restrictions: [
            rule("Pau", [floor(2), floor(1, "Sat.Lead")]),
            ...["A1", "A2", "A3", "B1", "B2", "B3"].map((n) => rule(n, [floor()])),
          ],
        },
        sundayDates,
        activeSatDates: sats,
        month,
      });
      expect(built.request.weekends_with_saturday, String(month)).toEqual([4, 5]);
      expect(built.omittedCaps, String(month)).toEqual([{ person: "Pau", cap: "Sat.Lead == 1", reason: "combined" }]);
      expect(built.request.dsl_rules, String(month)).toContain("Paulina Reyes Sat.* == 2");
    }
  });

  it("the final review's I1 (Nov 21/28): Ana's second floor is `combined`, and Beto, Caro and Dani all keep theirs", () => {
    // Ana, Beto, Caro and Dani are Sunday leads; S0–S2 are support. Ana has `Sat.* >= 2` then a
    // `Sat.Lead` floor; the others one `Sat.Lead` each. Merged, Ana's two became two Lead seats,
    // so with Beto and Caro the four Lead seats were full and Dani was left out as `capacity` —
    // falsely: main kept all four and the solver seated them (W4 Lead Caro and Dani with Ana on
    // BGV, W5 Lead Ana and Beto). Judged one per person (Q16), Ana's `Sat.* >= 2` can take BGV.
    // The `==` shapes too: the final review saw the same false `capacity` with them.
    const variants: Array<{ ana: RestrictionCap[]; op: RestrictionCap["op"] }> = [
      { ana: [floor(2, "Sat.*", ">="), floor(1, "Sat.Lead", ">=")], op: ">=" },
      { ana: [floor(2), floor(1, "Sat.Lead", ">=")], op: "==" },
      { ana: [floor(2), floor(1, "Sat.Lead")], op: "==" },
    ];
    const leads = ["Ana", "Beto", "Caro", "Dani"].map((n) => person(n.toLowerCase(), `${n} Apellido`, n));
    const support = ["S0", "S1", "S2"].map((n) => person(n.toLowerCase(), `${n} Apellido`, n));
    for (const { ana, op } of variants) {
      const built = build({
        members: [...leads, ...support],
        config: {
          sundayLeads: leads.map((p) => p._id),
          support: support.map((p) => p._id),
          restrictions: [rule("Ana", ana), ...["Beto", "Caro", "Dani"].map((n) => rule(n, [floor(1, "Sat.Lead", op)]))],
        },
        sundayDates: NOV,
        activeSatDates: ["2026-11-21", "2026-11-28"],
        month: 11,
      });
      const shape = `${ana.map((c) => c.op).join(",")} / ${op}`;
      expect(built.request.weekends_with_saturday, shape).toEqual([4, 5]);
      expect(built.omittedCaps, shape).toEqual([{ person: "Ana", cap: `Sat.Lead ${ana[1].op} 1`, reason: "combined" }]);
      expect(built.request.dsl_rules, shape).toEqual([
        `Ana Apellido Sat.* ${ana[0].op} 2`,
        `Beto Apellido Sat.Lead ${op} 1`,
        `Caro Apellido Sat.Lead ${op} 1`,
        `Dani Apellido Sat.Lead ${op} 1`,
      ]);
    }
  });

  it("Q16's order: `unreachable` is judged on every floor first, and «first» is the first REACHABLE floor (Q18)", () => {
    // Andy is support, in no lead pool, so a `Sat.Lead` floor is unreachable for him wherever it stands.
    const judge = (caps: RestrictionCap[]) => build({
      members: [person("frank", "Francisco Rocha", "Frank"), person("andy", "Andrés Ortega", "Andy")],
      config: { sundayLeads: ["frank"], support: ["andy"], restrictions: [rule("Andy", caps)] },
      activeSatDates: ["2026-10-31"],
    });
    // His second floor, and unreachable: reported as `unreachable` — the stronger reason, true
    // even alone — never as `combined`. His first floor stays.
    const second = judge([floor(), floor(1, "Sat.Lead", ">=")]);
    expect(second.omittedCaps).toEqual([{ person: "Andy", cap: "Sat.Lead >= 1", reason: "unreachable" }]);
    expect(second.request.dsl_rules).toEqual(["Andrés Ortega Sat.* == 1"]);
    // His first floor, and unreachable: his first REACHABLE floor is the one judged, so he keeps
    // `Sat.* == 1`, and only the reachable floor after it is `combined`. (Moved by ruling Q18: by
    // position, `Sat.* == 1` was `combined` too and Andy kept no Saturday floor at all.)
    const first = judge([floor(1, "Sat.Lead", ">="), floor(), floor(1, "Sat.BGV", ">=")]);
    expect(first.omittedCaps).toEqual([
      { person: "Andy", cap: "Sat.Lead >= 1", reason: "unreachable" },
      { person: "Andy", cap: "Sat.BGV >= 1", reason: "combined" },
    ]);
    expect(first.request.dsl_rules).toEqual(["Andrés Ortega Sat.* == 1"]);
  });

  it("Q16 counts every rule that names the person: a later rule's floor, by member_name, is `combined`", () => {
    const built = build({
      members: [person("frank", "Francisco Rocha", "Frank"), person("andy", "Andrés Ortega", "Andy")],
      config: {
        sundayLeads: ["frank"],
        support: ["andy"],
        restrictions: [rule("Andy", [floor()]), { ...rule("Andrés Ortega", [floor(1, "Sat.BGV", ">=")]), id: "r2" }],
      },
      activeSatDates: ["2026-10-31"],
    });
    expect(built.omittedCaps).toEqual([{ person: "Andrés Ortega", cap: "Sat.BGV >= 1", reason: "combined" }]);
    expect(built.request.dsl_rules).toEqual(["Andrés Ortega Sat.* == 1"]);
  });

  it("I-B: a Saturday's only possible lead cannot sit in its BGV seat for their own minimum", () => {
    // The 31st is sent; Frank is away that day, so Leo is the only lead who can lead it. The
    // solver needs a Lead on every Saturday and seats a person once, so Leo's `Sat.BGV >= 1`
    // cannot be met there — the solver refused it (ok: false). With Frank free, Leo can.
    const LEO = person("leo", "Leonardo Ruiz", "Leo");
    const support = [person("ana", "Ana Apellido", "Ana"), person("beto", "Beto Apellido", "Beto")];
    const month = (frank: RankMember) => build({
      members: [frank, LEO, ...support],
      config: { sundayLeads: ["frank", "leo"], support: ["ana", "beto"], restrictions: [rule("Leo", [floor(1, "Sat.BGV", ">=")])] },
      activeSatDates: ["2026-10-31"],
    });
    const away = month(person("frank", "Francisco Rocha", "Frank", { unavailableDates: ["2026-10-31"] }));
    expect(away.trailing).toEqual({ date: "2026-10-31", sent: true });
    expect(away.omittedCaps).toEqual([{ person: "Leo", cap: "Sat.BGV >= 1", reason: "capacity" }]);
    expect(month(person("frank", "Francisco Rocha", "Frank")).omittedCaps).toEqual([]);
  });

  it("M2: a floor of value v needs v DIFFERENT Saturdays — one seat per person per Saturday", () => {
    // The 24th and the 31st sent. L1 and L2 (leads, `Sat.Lead == 1`) and S1–S3 (support,
    // `Sat.* == 1`) are all away on the 31st, so they fill the 24th: both Lead seats and all
    // three BGV seats. ZP, a lead with `Sat.* == 2`, has only the 31st left — one Saturday, so
    // one seat, however many are free there. Frank, a lead with no minimum, can lead the 31st.
    const away = { unavailableDates: ["2026-10-31"] };
    const leads = ["L1", "L2"].map((n) => person(n.toLowerCase(), `${n} Apellido`, n, away));
    const support = ["S1", "S2", "S3"].map((n) => person(n.toLowerCase(), `${n} Apellido`, n, away));
    const built = build({
      members: [...leads, ...support, person("zp", "ZP Apellido", "ZP"), person("frank", "Francisco Rocha", "Frank")],
      config: {
        sundayLeads: ["l1", "l2", "zp", "frank"],
        support: support.map((p) => p._id),
        restrictions: [
          rule("L1", [floor(1, "Sat.Lead")]), rule("L2", [floor(1, "Sat.Lead")]),
          ...["S1", "S2", "S3"].map((n) => rule(n, [floor()])),
          rule("ZP", [floor(2)]),
        ],
      },
      activeSatDates: ["2026-10-24", "2026-10-31"],
    });
    expect(built.omittedCaps).toEqual([{ person: "ZP", cap: "Sat.* == 2", reason: "capacity" }]);
  });

  it("keeps each minimum that still fits: a Lead floor over the Lead seats does not push out a BGV floor after it", () => {
    const people = [person("ana", "Ana A", "Ana"), person("beto", "Beto B", "Beto"), person("caro", "Caro C", "Caro"), person("dani", "Dani D", "Dani")];
    const built = build({
      members: people,
      config: {
        sundayLeads: ["ana", "beto", "caro"],
        support: ["dani"],
        restrictions: [rule("Ana", [floor(1, "Sat.Lead")]), rule("Beto", [floor(1, "Sat.Lead")]), rule("Caro", [floor(1, "Sat.Lead")]), rule("Dani", [floor(1, "Sat.BGV")])],
      },
      activeSatDates: ["2026-10-31"],
    });
    expect(built.omittedCaps).toEqual([{ person: "Caro", cap: "Sat.Lead == 1", reason: "capacity" }]);
    expect(built.request.dsl_rules).toContain("Dani D Sat.BGV == 1");
  });

  it("an unreachable floor is judged first and takes no seat", () => {
    // Three support minimums fill the 31st's three BGV seats exactly; Tay's, unreachable, must
    // not cost any of them a seat. (Was five support minimums: two of those never had a seat.)
    const withTay = [...members, person("tay", "Tay Apellido", "Tay", { unavailableDates: ["2026-10-31"] })];
    const built = build({
      members: withTay,
      config: { ...config, support: [...(config.support ?? []), "tay"], restrictions: [rule("Tay", [floor()]), ...names.slice(0, 3).map((n) => rule(n, [floor()]))] },
      activeSatDates: ["2026-10-31"],
    });
    expect(built.omittedCaps).toEqual([{ person: "Tay", cap: "Sat.* == 1", reason: "unreachable" }]);
  });
});

describe("T5: the trailing Saturday is sent only if someone can lead it", () => {
  const FRANK = person("frank", "Francisco Rocha", "Frank", { unavailableDates: ["2026-10-31"] });
  const GABY = person("gaby", "Gabriela Díaz", "Gaby", { unavailableDates: ["2026-10-31"] });
  const ANDY = person("andy", "Andrés Ortega", "Andy"); // support: free on the 31st, but not a lead
  const members = [FRANK, GABY, ANDY];
  const config: Partial<SolverConfig> = {
    sundayLeads: ["frank"], saturdayLeads: ["gaby"], support: ["andy"],
    restrictions: [rule("Andy", [floor()])],
  };
  // Ruling Q17 extended the parenthesis with «o sin sábados libres en su regla».
  const NOTICE = "El sábado 31 oct no se mandó al solver: ningún líder puede dirigirlo (no disponibles, excluidos o sin sábados libres en su regla). Llénalo a mano.";

  it("every lead unavailable on the 31st: week 5 is not sent, and the notice says why", () => {
    const built = build({ members, config, activeSatDates: ["2026-10-31"] });
    expect(built.request.weekends_with_saturday).toEqual([]);
    expect(built.trailing).toEqual({ date: "2026-10-31", sent: false, reason: "noLead" });
    expect(trailingNotice(built.trailing!)).toBe(NOTICE);
    // Not sent, so no availability rule for it, and no Saturday left for Andy's floor.
    expect(built.request.dsl_rules.join("\n")).not.toContain("week 5");
    expect(built.omittedCaps).toEqual([{ person: "Andy", cap: "Sat.* == 1", reason: "noSaturday" }]);
  });

  it("with the 3rd also selected, only week 1 is sent and the floor is judged against it", () => {
    const built = build({ members, config, activeSatDates: ["2026-10-03", "2026-10-31"] });
    expect(built.request.weekends_with_saturday).toEqual([1]);
    expect(built.trailing).toEqual({ date: "2026-10-31", sent: false, reason: "noLead" });
    expect(built.omittedCaps).toEqual([]);
    expect(built.request.dsl_rules).toEqual(["Andrés Ortega Sat.* == 1"]);
  });

  it("a `!in` pattern or a week-5 exclusion covering Sat.Lead counts as unable, through the rule's alias", () => {
    const free = [person("frank", "Francisco Rocha", "Frank"), person("gaby", "Gabriela Díaz", "Gaby"), ANDY];
    const verdict = (restrictions: PersonRestriction[]) => {
      const built = build({ members: free, config: { ...config, restrictions }, activeSatDates: ["2026-10-31"] });
      return { trailing: built.trailing, weeks: built.request.weekends_with_saturday, dsl: built.request.dsl_rules };
    };
    expect(verdict([
      rule("Frank", [], { excludedPatterns: ["Sat.*"] }),
      rule("Gaby", [], { excludedPatterns: ["Lead.*"] }),
    ])).toEqual({
      trailing: { date: "2026-10-31", sent: false, reason: "noLead" },
      weeks: [],
      dsl: ["Francisco Rocha !in Sat.*", "Gabriela Díaz !in Lead.*"],
    });
    // Withheld BY its week-5 exclusion: the exclusion binds no seat, so it is not sent — the
    // solver refuses a week the request does not have (fix round 1, I1). Frank's rule had no
    // other clause, so his line goes.
    expect(verdict([
      rule("Frank", [], { weekExclusions: [{ id: "w", week: 5, pattern: "Sat.Lead" }] }),
      rule("Gaby", [], { excludedPatterns: ["*.Lead"] }),
    ])).toEqual({
      trailing: { date: "2026-10-31", sent: false, reason: "noLead" },
      weeks: [],
      dsl: ["Gabriela Díaz !in *.Lead"],
    });
    // Counter-cases: a BGV-only exclusion, another week, or one lead left free — sent.
    expect(verdict([
      rule("Frank", [], { excludedPatterns: ["Sat.BGV"] }),
      rule("Gaby", [], { weekExclusions: [{ id: "w", week: 4, pattern: "Sat.*" }] }),
    ])).toEqual({
      trailing: { date: "2026-10-31", sent: true },
      weeks: [5],
      dsl: ["Francisco Rocha !in Sat.BGV", "Gabriela Díaz !in week 4 Sat.*"],
    });
    expect(verdict([rule("Frank", [], { excludedPatterns: ["Sat.*"] })])).toEqual({
      trailing: { date: "2026-10-31", sent: true },
      weeks: [5],
      dsl: ["Francisco Rocha !in Sat.*"],
    });
  });

  it("withheld for availability: nobody's week-5 exclusion is sent, and every other clause stays", () => {
    const built = build({
      members,
      config: {
        ...config,
        restrictions: [rule("Andy", [], {
          excludedPatterns: ["Sun.Choir"],
          weekExclusions: [{ id: "w2", week: 2, pattern: "Sat.BGV" }, { id: "w5", week: 5, pattern: "Sat.*" }],
        })],
      },
      activeSatDates: ["2026-10-10", "2026-10-31"],
    });
    expect(built.trailing).toEqual({ date: "2026-10-31", sent: false, reason: "noLead" });
    expect(built.request.weekends_with_saturday).toEqual([2]);
    expect(built.request.dsl_rules).toEqual(["Andrés Ortega !in Sun.Choir & !in week 2 Sat.BGV"]);
    expect(built.request.dsl_rules.join("\n")).not.toContain("week 5");
  });

  it("sent: a week-5 exclusion is still emitted", () => {
    const built = build({
      members: [FRANK, person("gaby", "Gabriela Díaz", "Gaby"), ANDY],
      config: { ...config, restrictions: [rule("Andy", [], { weekExclusions: [{ id: "w", week: 5, pattern: "Sat.*" }] })] },
      activeSatDates: ["2026-10-31"],
    });
    expect(built.trailing).toEqual({ date: "2026-10-31", sent: true });
    expect(built.request.dsl_rules).toEqual(["Andrés Ortega !in week 5 Sat.*", "Francisco Rocha !in week 5 Sat.*"]);
  });

  it("never widened: a week-5 exclusion with the 31st deselected, or in a month with no trailing Saturday, is sent as today", () => {
    // Today's behaviour, kept on purpose (ruling Q9): the solver refuses it with a 422 naming
    // the rule. Only a trailing Saturday that T5 withheld drops its week's exclusions.
    const sem5 = { ...config, restrictions: [rule("Andy", [], { weekExclusions: [{ id: "w", week: 5, pattern: "Sat.*" }] })] };
    const deselected = build({ members, config: sem5, activeSatDates: OCT_SATS });
    expect(deselected.trailing).toBeNull();
    expect(deselected.request.dsl_rules).toContain("Andrés Ortega !in week 5 Sat.*");
    // September 2026: Sundays 6/13/20/27, and 27 + 6 is 3 Oct — four weeks, no trailing Saturday.
    const SEP = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"];
    const september = build({ members, config: sem5, sundayDates: SEP, activeSatDates: ["2026-09-05"], month: 9 });
    expect(september.trailing).toBeNull();
    expect(september.request.dsl_rules).toContain("Andrés Ortega !in week 5 Sat.*");
  });

  it("one lead free on the 31st is enough, and a member unavailable there is kept off it", () => {
    const built = build({ members: [FRANK, person("gaby", "Gabriela Díaz", "Gaby"), ANDY], config, activeSatDates: ["2026-10-31"] });
    expect(built.request.weekends_with_saturday).toEqual([5]);
    expect(built.trailing).toEqual({ date: "2026-10-31", sent: true });
    expect(built.request.dsl_rules).toEqual(["Andrés Ortega Sat.* == 1", "Francisco Rocha !in week 5 Sat.*"]);
  });

  it("a month with a trailing Saturday nobody selected has no verdict", () => {
    expect(build({ members, config, activeSatDates: ["2026-10-03"] }).trailing).toBeNull();
  });
});

describe("T5 / Q17: a lead whose Saturday maximum is used up by the other Saturdays cannot lead the 31st", () => {
  // October 2026, the 24th and the 31st selected (the final review's m1). Frank is away on both, so
  // Andy, a Sunday lead, is the only possible lead on each. The solver puts him on the 24th
  // (`mandatory_lead`), and with `Sat.* == 1` he cannot lead the 31st too: sending it refused the
  // whole month, Sundays included. Main sent the 24th alone and solved.
  const FRANK = person("frank", "Francisco Rocha", "Frank", { unavailableDates: ["2026-10-24", "2026-10-31"] });
  const ANDY = person("andy", "Andrés Ortega", "Andy");
  const TAY = person("tay", "Taylor Ruiz", "Tay");
  const OCT_24_31 = ["2026-10-24", "2026-10-31"];
  const WITHHELD = { date: "2026-10-31", sent: false, reason: "noLead" };
  const SENT = { date: "2026-10-31", sent: true };
  const month = (andyCaps: RestrictionCap[], opts: { gaby?: RankMember; activeSatDates?: string[] } = {}) => build({
    members: [FRANK, ANDY, TAY, ...(opts.gaby ? [opts.gaby] : [])],
    config: {
      sundayLeads: ["frank", "andy"],
      saturdayLeads: opts.gaby ? ["gaby"] : [],
      support: ["tay"],
      restrictions: [rule("Andy", andyCaps)],
    },
    activeSatDates: opts.activeSatDates ?? OCT_24_31,
  });

  it("m1: Andy's `Sat.* == 1` is used up by the 24th, so only week 4 is sent, and the notice says why", () => {
    const built = month([floor()]);
    expect(built.request.weekends_with_saturday).toEqual([4]);
    expect(built.trailing).toEqual(WITHHELD);
    expect(trailingNotice(built.trailing!)).toBe(
      "El sábado 31 oct no se mandó al solver: ningún líder puede dirigirlo (no disponibles, excluidos o sin sábados libres en su regla). Llénalo a mano.",
    );
    // His minimum is met on the 24th and stays; nothing names week 5.
    expect(built.omittedCaps).toEqual([]);
    expect(built.request.dsl_rules).toEqual(["Andrés Ortega Sat.* == 1", "Francisco Rocha !in week 4 Sat.*"]);
  });

  it("a second possible lead on the 24th leaves Andy his Saturday: the 31st is sent", () => {
    // Gaby, a Saturday lead, is free on the 24th and away on the 31st.
    const GABY = person("gaby", "Gabriela Díaz", "Gaby", { unavailableDates: ["2026-10-31"] });
    const built = month([floor()], { gaby: GABY });
    expect(built.request.weekends_with_saturday).toEqual([4, 5]);
    expect(built.trailing).toEqual(SENT);
  });

  it("a zero maximum bars the only lead outright, through every pattern that covers Sat.Lead", () => {
    const only31 = { activeSatDates: ["2026-10-31"] };
    for (const cap of [floor(0, "Sat.Lead", "<="), floor(0, "Sat.*", "<="), floor(0, "*.Lead", "=="), floor(0, "Lead.*", "<="), floor(0, "*.*", "<=")]) {
      const built = month([cap], only31);
      expect(built.trailing, cap.id).toEqual(WITHHELD);
      expect(built.request.weekends_with_saturday, cap.id).toEqual([]);
    }
    // Not a maximum on `Sat.Lead`, or not a maximum at all: Andy can still lead it.
    for (const cap of [floor(0, "Sat.BGV", "<="), floor(1, "Sat.Lead", ">=")]) {
      expect(month([cap], only31).trailing, cap.id).toEqual(SENT);
    }
  });

  it("a maximum above the Saturdays he is forced to lead leaves room: `<= 2` and `== 2` send the 31st", () => {
    for (const cap of [floor(2, "Sat.*", "<="), floor(2, "Sat.Lead", "==")]) {
      const built = month([cap]);
      expect(built.request.weekends_with_saturday, cap.id).toEqual([4, 5]);
      expect(built.trailing, cap.id).toEqual(SENT);
    }
  });

  it("a relative maximum resolves as the solver does: `Sat.* <= {weeks-3}` is 1 in a four-Sunday month", () => {
    expect(month([{ ...floor(0, "Sat.*", "<="), relative: true, relOffset: 3 }]).trailing).toEqual(WITHHELD);
    expect(month([{ ...floor(0, "Sat.*", "<="), relative: true, relOffset: 2 }]).trailing).toEqual(SENT);
  });
});

describe("omittedCapsNotices / trailingNotice", () => {
  it("is empty when nothing was left out", () => {
    expect(omittedCapsNotices([])).toEqual([]);
  });

  it("one line per reason, always in the order noSaturday, unreachable, combined, capacity; grouped by rule inside each", () => {
    expect(omittedCapsNotices([
      { person: "Eli", cap: "Sat.* == 1", reason: "capacity" },
      { person: "Tay", cap: "Sat.* == 1", reason: "unreachable" },
      { person: "Pau", cap: "Sat.Lead == 1", reason: "combined" },
      { person: "Andy", cap: "Sat.Lead >= 1", reason: "unreachable" },
      { person: "Vale", cap: "Sat.* == 1", reason: "unreachable" },
      { person: "Beto", cap: "Sat.* == 1", reason: "noSaturday" },
      { person: "Fer", cap: "Sat.BGV == 1", reason: "capacity" },
    ])).toEqual([
      "Este mes no tiene sábados que Auto pueda cubrir, así que no se aplicó «Sat.* == 1» a Beto.",
      `No se aplicó «Sat.* == 1» a Tay y Vale y «Sat.Lead >= 1» a Andy: ${UNREACHABLE_TAIL}`,
      "No se aplicó «Sat.Lead == 1» a Pau: Auto no combina dos mínimos de sábado de la misma persona.",
      "No caben todos los mínimos de sábado en los lugares de sábado de este mes, así que no se aplicó «Sat.* == 1» a Eli y «Sat.BGV == 1» a Fer.",
    ]);
  });

  it("the combined line is number-neutral and groups people under each rule", () => {
    expect(omittedCapsNotices([
      { person: "Ana", cap: "Sat.BGV >= 1", reason: "combined" },
      { person: "Pau", cap: "Sat.BGV >= 1", reason: "combined" },
    ])).toEqual(["No se aplicó «Sat.BGV >= 1» a Ana y Pau: Auto no combina dos mínimos de sábado de la misma persona."]);
  });

  it("the unreachable line joins people with joinEs", () => {
    expect(omittedCapsNotices([
      { person: "Andy", cap: "Sat.* == 1", reason: "unreachable" },
      { person: "Tay", cap: "Sat.* == 1", reason: "unreachable" },
      { person: "Vale", cap: "Sat.* == 1", reason: "unreachable" },
    ])).toEqual([`No se aplicó «Sat.* == 1» a Andy, Tay y Vale: ${UNREACHABLE_TAIL}`]);
  });

  it("trailingNotice names the day with dayLabel, and is null for a sent Saturday", () => {
    expect(trailingNotice({ date: "2026-01-31", sent: false, reason: "noLead" })).toBe(
      "El sábado 31 ene no se mandó al solver: ningún líder puede dirigirlo (no disponibles, excluidos o sin sábados libres en su regla). Llénalo a mano.",
    );
    expect(trailingNotice({ date: "2026-10-31", sent: true })).toBeNull();
  });
});

describe("November 2026 (no trailing Saturday): the request is byte-identical to before", () => {
  it("matches a hand-written request, key order included", () => {
    const members = [
      person("frank", "Francisco Rocha", "Frank", { unavailableDates: ["2026-11-15"] }), // Sunday, week 3
      person("gaby", "Gabriela Díaz", "Gaby"),
      person("andy", "Andrés Ortega", "Andy", { unavailableDates: ["2026-11-07"] }), // Saturday of week 2
      person("tay", "Taylor Ruiz", "Tay", { unavailableDates: ["2026-10-31"] }), // the eve of week 1, as always
      person("vale", "Valeria Soto", "Vale"),
    ];
    const built = build({
      members,
      sundayDates: NOV,
      activeSatDates: NOV_SATS,
      month: 11,
      config: {
        sundayLeads: ["frank"],
        saturdayLeads: ["gaby"],
        support: ["andy", "tay", "vale"],
        restrictions: [
          rule("Andy", [floor()], { excludedPatterns: ["Sun.BGV"], fairness: "slack", fairnessSlack: 2 }),
          rule("Tay", [{ ...floor(0, "Sat.BGV", ">="), relative: true, relOffset: 4 }], {
            weekExclusions: [{ id: "w", week: 2, pattern: "Sat.*" }],
          }),
          rule("Gaby", [floor(1, "Sat.Lead"), floor(2, "Sun.*", "<=")]),
        ],
        conflicts: [{ id: "c", personA: "Andy", personB: "Tay", pattern: "*.BGV" }],
        presence: [{ id: "p", persons: ["Frank", "Gaby"], pattern: "Sun.Lead" }],
      },
      historyEntries: [
        { key: "2026-10", year: 2026, month: 10, total_counts: { "Francisco Rocha": 4 }, role_counts: { "Francisco Rocha": { "Sun.Lead": 4 } } },
        { key: "2026-11", year: 2026, month: 11, total_counts: { "Francisco Rocha": 9 }, role_counts: {} },
      ],
    });
    expect(JSON.stringify(built.request)).toBe(
      '{"weeks":5,"weekends_with_saturday":[2,3,4,5],'
      + '"sunday_leads":["Francisco Rocha"],"saturday_leads":["Gabriela Díaz"],'
      + '"support":["Andrés Ortega","Taylor Ruiz","Valeria Soto"],'
      + '"dsl_rules":['
      + '"Andrés Ortega !in Sun.BGV & Sat.* == 1 & fairness_slack 2",'
      + '"Taylor Ruiz !in week 2 Sat.* & Sat.BGV >= {weeks-4}",'
      + '"Gabriela Díaz Sat.Lead == 1 & Sun.* <= 2",'
      + '"Andrés Ortega !with Taylor Ruiz on *.BGV",'
      + '"any_of(Francisco Rocha,Gabriela Díaz) on Sun.Lead each_week",'
      + '"Francisco Rocha !in week 3 Sun.*",'
      + '"Andrés Ortega !in week 2 Sat.*",'
      + '"Taylor Ruiz !in week 1 Sat.*"],'
      + '"history":[{"total_counts":{"Francisco Rocha":4},"role_counts":{"Francisco Rocha":{"Sun.Lead":4}}}]}',
    );
    expect(built.omittedCaps).toEqual([]);
    expect(built.trailing).toBeNull();
  });
});

describe("trailingSaturday on 29- and 30-day months", () => {
  it("is the 29th of a leap February and the 30th of a 30-day month", () => {
    // Feb 2020: Sundays 2/9/16/23, and 23 + 6 is the 29th of a leap year.
    expect(trailingSaturday(["2020-02-02", "2020-02-09", "2020-02-16", "2020-02-23"])).toBe("2020-02-29");
    // Nov 2024: Sundays 3/10/17/24, and 24 + 6 is the 30th, still November.
    expect(trailingSaturday(["2024-11-03", "2024-11-10", "2024-11-17", "2024-11-24"])).toBe("2024-11-30");
  });
});
