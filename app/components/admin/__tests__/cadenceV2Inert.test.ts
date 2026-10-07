// Solver v3 C3 §6.4 (parent A8, A34) — v2 is inert to «Mes por medio» (T8).
//
// For a config `C`, `v2View(C)` is `C` with `sundayCadence` removed from every
// restriction and every restriction removed that CARRIED it and, without it, has
// no clause (no excluded pattern, no week exclusion, no cap, fairness "none") —
// exactly what the pre-C3 form could not have produced. The invariant: every v2
// answer for `C` deep-equals the answer for `v2View(C)`. Removing only the field
// is not enough, because `solverPools` reads the `person` of EVERY restriction:
// a cadence-only card would inject an unpooled member into `support` and make a
// member with no Tipo refuse the month (E9). The one deliberate difference —
// `unresolvedRuleNames` also reports a cadence-only name that matches nobody —
// is asserted at the end.
import { describe, expect, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import {
  buildColumns,
  buildRows,
  buildSolveRequest,
  createColumnId,
  solverPools,
  v2View,
  type GridCell,
  type PersonRestriction,
  type SolverConfig,
  type SolverHistoryEntry,
} from "../plannerModel";
import { collectPins, pinConflicts, type Pin } from "../pinModel";
import { evaluate, ruleViolationsForColumn, unresolvedRuleNames } from "../ruleEnforcement";
import { fairnessByMemberId } from "../localFill";
import { priorMonthLeadVisibility } from "../leadPoolHistory";
import { pinViolationNotices } from "../pinViolations";

const SUNDAYS = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];
const SATURDAYS = ["2026-10-10", "2026-10-31"]; // the 31st is the trailing Saturday (week 5)

const m = (id: string, name: string, alias: string, memberType: string[], extra: Partial<RankMember> = {}): RankMember =>
  ({ _id: id, member_name: name, alias, memberType, ...extra } as RankMember);
const ANA = m("m-ana", "Ana Ruiz", "Ana", ["voz", "sunday_lead"], { unavailableDates: ["2026-10-11"] });
const BRUNO = m("m-bruno", "Bruno Díaz", "Bruno", ["voz", "saturday_lead"]);
const CARLA = m("m-carla", "Carla Soto", "Carla", ["voz", "sunday_lead", "saturday_lead"]);
const DIANA = m("m-diana", "Diana Paz", "Diana", []); // no Tipo: not schedulable (ADR-0029)
const ELENA = m("m-elena", "Elena Mora", "Elena", ["voz", "support"], { unavailableDates: ["2026-10-17"] }); // in no pool
const FER = m("m-fer", "Fernando Gil", "Fer", ["voz", "support"]);
const MEMBERS = [ANA, BRUNO, CARLA, DIANA, ELENA, FER];

const rule = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], ...patch,
});
const cadenceOnly = (id: string, person: string) => rule(id, person, { sundayCadence: "alternate" });

const BASE: SolverConfig = {
  sundayLeads: ["m-ana", "m-carla"],
  saturdayLeads: ["m-bruno", "m-carla"],
  support: ["m-fer"],
  restrictions: [
    rule("r-bruno", "Bruno", { caps: [{ id: "c-b", pattern: "Sat.*", op: "<=", value: 2, relative: false, relOffset: 0 }] }),
    rule("r-fer", "Fer", { weekExclusions: [{ id: "w-f", week: 2, pattern: "*.*" }], fairness: "exempt" }),
  ],
  conflicts: [{ id: "x-1", personA: "Ana", personB: "Carla", pattern: "*.Lead" }],
  presence: [{ id: "p-1", persons: ["Ana", "Fer"], pattern: "Sun.BGV" }],
};
const withRules = (...extra: PersonRestriction[]): SolverConfig => ({ ...BASE, restrictions: [...BASE.restrictions, ...extra] });

const CORPUS: [string, SolverConfig][] = [
  ["the cadence on a clause-bearing restriction",
    withRules(rule("r-ana", "Ana", { excludedPatterns: ["Sat.*"], fairness: "exempt", sundayCadence: "alternate" }))],
  ["a cadence-only restriction for a pooled member", withRules(cadenceOnly("r-carla", "Carla"))],
  ["a cadence-only restriction for an unpooled member (pinned to a BGV seat below)", withRules(cadenceOnly("r-elena", "Elena"))],
  ["a cadence-only restriction for a member with no Tipo", withRules(cadenceOnly("r-diana", "Diana"))],
  ["a cadence-only restriction whose name matches nobody", withRules(cadenceOnly("r-zoe", "Zoe"))],
  ["a clause-less «Holgura 0» restriction that never carried it, beside a cadence-only one",
    withRules(rule("r-fer0", "Fer", { fairness: "slack", fairnessSlack: 0 }), cadenceOnly("r-carla", "Carla"))],
  ["a cadence-only card ahead of an exclusion card with the same person text (first-match readers)",
    withRules(cadenceOnly("r-1", "m-carla"), rule("r-2", "m-carla", { excludedPatterns: ["Sun.Lead"] }))],
];

const ROWS = buildRows();
const VOICE_ROWS = ROWS.filter((r) => ["lead", "bgv", "coro"].includes(r.id));
const COLUMNS = buildColumns({ sundayDates: SUNDAYS, activeSatDates: SATURDAYS });
const SUN1 = createColumnId("sunday_role", "2026-10-04");
const SAT2 = createColumnId("saturday_role", "2026-10-10");
const cell = (columnId: string, rowId: string, ids: string[]): GridCell => ({
  columnId, rowId, occupants: ids.map((memberId) => ({ memberId })), origin: "manual",
});
// Elena pinned to a Sunday BGV seat: under v2 she is in no pool, so the pin
// board must flag her `outsidePool` for `C` exactly as for `v2View(C)`.
const CELLS = [cell(SUN1, "lead", ["m-ana"]), cell(SUN1, "bgv", ["m-elena", "m-carla"]), cell(SAT2, "lead", ["m-bruno"])];
const HISTORY: SolverHistoryEntry[] = [
  { key: "2026-9", year: 2026, month: 9, total_counts: { "Ana Ruiz": 2 }, role_counts: { "Ana Ruiz": { "Sun.Lead": 2 } } },
];
const PINS: Pin[] = [{ week: 1, role: "Sun.BGV", person: "Elena Mora" }];
const VIOLATIONS = ["Bruno Díaz: Sat.* <= 2", "W1 Sun: Ana Ruiz !with Carla Soto on *.Lead", "W1: any_of(Ana Ruiz,Fernando Gil) on Sun.BGV each_week"];

/** Every v2 answer this spec's invariant names, for one config. */
function v2Answers(config: SolverConfig) {
  const pools = solverPools(config, MEMBERS);
  const request = (withholdTrailing: boolean) => buildSolveRequest({
    config, members: MEMBERS, sundayDates: SUNDAYS, activeSatDates: SATURDAYS,
    historyEntries: HISTORY, year: 2026, month: 10, withholdTrailing,
  });
  const collected = collectPins({ cells: CELLS, columns: COLUMNS, rows: ROWS, members: MEMBERS, sundayDates: SUNDAYS });
  const assignedFor = (columnId: string) => CELLS
    .filter((c) => c.columnId === columnId)
    .flatMap((c) => c.occupants.map((o) => ({ seatId: c.rowId, category: "voz" as const, memberId: o.memberId })));
  return {
    pools: { ...pools, requestMemberIds: [...pools.requestMemberIds] },
    request: request(false),
    requestWithheld: request(true),
    pinConflicts: [...pinConflicts({
      collected, columns: COLUMNS, members: MEMBERS,
      pools: { sundayLeads: pools.sundayLeadNames, saturdayLeads: pools.saturdayLeadNames, support: [...pools.supportNames, ...pools.extraSupport] },
    })],
    verdicts: COLUMNS.flatMap((column) => VOICE_ROWS.flatMap((row) => MEMBERS.map((member) =>
      evaluate({ member, row, column, sundayDates: SUNDAYS, assigned: assignedFor(column.columnId), members: MEMBERS, config })))),
    seatedViolations: COLUMNS.map((column) => [...ruleViolationsForColumn({
      column, rows: ROWS, assigned: assignedFor(column.columnId), members: MEMBERS, sundayDates: SUNDAYS, config,
    })]),
    fairness: [...fairnessByMemberId(config, MEMBERS)],
    leadVisibility: (["Sun.Lead", "Sat.Lead"] as const).map((role) =>
      priorMonthLeadVisibility({ config, members: MEMBERS, history: HISTORY, year: 2026, month: 10, role })),
    pinNotices: pinViolationNotices({ violations: VIOLATIONS, ceilingProven: true, config, members: MEMBERS, pins: PINS, sundayDates: SUNDAYS }),
  };
}

describe("v2View (C3 §6.4)", () => {
  it("removes the field everywhere and the restrictions that carried ONLY the cadence", () => {
    const config = withRules(
      rule("r-ana", "Ana", { excludedPatterns: ["Sat.*"], sundayCadence: "alternate" }),
      cadenceOnly("r-carla", "Carla"),
      rule("r-gabi", "Gabi", { fairness: "slack", fairnessSlack: 0, sundayCadence: "alternate" }),
    );
    expect(v2View(config).restrictions.map((r) => r.id)).toEqual(["r-bruno", "r-fer", "r-ana", "r-gabi"]);
    for (const r of v2View(config).restrictions) expect(r).not.toHaveProperty("sundayCadence");
  });

  it("never removes a restriction that did not carry the cadence, clause-less or not", () => {
    const config = withRules(rule("r-fer0", "Fer", { fairness: "slack", fairnessSlack: 0 }), rule("r-empty", "Ana"));
    expect(v2View(config)).toEqual(config);
  });

  it("does not mutate its input", () => {
    const config = withRules(cadenceOnly("r-carla", "Carla"));
    const before = JSON.stringify(config);
    v2View(config);
    expect(JSON.stringify(config)).toBe(before);
  });
});

describe("every v2 answer is the same for C and v2View(C) (C3 T8)", () => {
  for (const [label, config] of CORPUS) {
    it(label, () => {
      expect(v2Answers(config)).toEqual(v2Answers(v2View(config)));
    });
  }

  it("the corpus is not vacuous: each case moves something a field-strip alone would leave", () => {
    // Stripping only the field leaves a clause-less restriction that still
    // reaches `solverPools`. Pinned so the corpus keeps exercising E9.
    const strip = (c: SolverConfig): SolverConfig => ({
      ...c, restrictions: c.restrictions.map(({ sundayCadence: _drop, ...r }) => { void _drop; return r; }),
    });
    const unpooled = CORPUS[2][1];
    expect(solverPools(strip(unpooled), MEMBERS).extraSupport).toContain("Elena Mora");
    expect(solverPools(unpooled, MEMBERS).extraSupport).not.toContain("Elena Mora");
    const noTipo = CORPUS[3][1];
    expect(solverPools(strip(noTipo), MEMBERS).dslBlockedByTipo).toEqual(["Diana"]);
    expect(solverPools(noTipo, MEMBERS).dslBlockedByTipo).toEqual([]);
  });

  it("the one deliberate difference: an unresolvable cadence-only name is still reported", () => {
    const zoe = CORPUS[4][1];
    expect(unresolvedRuleNames(zoe, MEMBERS)).toContain("Zoe");
    expect(unresolvedRuleNames(v2View(zoe), MEMBERS)).not.toContain("Zoe");
  });
});
