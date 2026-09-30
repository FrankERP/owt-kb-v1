/**
 * A Saturday MINIMUM in a month with no Saturday Auto can staff.
 *
 * October 2026 has Sundays 4/11/18/25 and one Saturday service, the 31st — the eve of
 * 1 Nov, which was outside Auto's reach (D16) when this was written. Three saved rules
 * said `Sat.* == 1`, the solver got no Saturday seats, fixed each person's Saturday count
 * at 0, and refused the whole month: Sundays empty, «El solver no encontró solución.».
 * Frank's decision (2026-09-29): in such a month the Saturday minimum is simply not
 * applied — and the admin is told it was not.
 *
 * Since ADR-0048 (T1/T5) the 31st is week 5 and IS sent whenever a lead can take it, so
 * "no Saturday for Auto" now means: none selected, or only the 31st with no lead able to
 * lead it. The per-person reasons (T3/T4) are pinned in `trailingSaturday.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import {
  SOLVER_REFUSAL,
  buildSolveRequest,
  capLabel,
  capText,
  isSaturdayFloor,
  omittedCapsNotices,
  solverRefusalMessage,
  type PersonRestriction,
  type RestrictionCap,
  type SolverConfig,
} from "../plannerModel";

const OCT_SUNDAYS = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];
const POOL_TIPO = ["voz", "sunday_lead", "saturday_lead", "support"];
const m = (id: string, name: string): RankMember =>
  ({ _id: id, member_name: name, memberType: POOL_TIPO } as RankMember);

const cap = (pattern: string, op: RestrictionCap["op"], value: number, relOffset?: number): RestrictionCap => ({
  id: `${pattern}${op}${value}`,
  pattern,
  op,
  value,
  relative: relOffset !== undefined,
  relOffset: relOffset ?? 2,
});

const restriction = (person: string, caps: RestrictionCap[], extra: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id: `r-${person}`,
  person,
  excludedPatterns: [],
  fairness: "none",
  fairnessSlack: 0,
  weekExclusions: [],
  caps,
  ...extra,
});

const members = [m("andy", "Andy"), m("tay", "Tay"), m("frank", "Frank")];
/** Frank, the only lead, cannot take the 31st — so T5 withholds it and Auto has no Saturday. */
const frankAwayOn31 = [m("andy", "Andy"), m("tay", "Tay"), { ...m("frank", "Frank"), unavailableDates: ["2026-10-31"] }];

function solve(restrictions: PersonRestriction[], activeSatDates: string[], people: RankMember[] = members) {
  const config: SolverConfig = {
    sundayLeads: ["frank"], saturdayLeads: [], support: ["andy", "tay"],
    restrictions, conflicts: [], presence: [],
  };
  const built = buildSolveRequest({
    config, members: people, sundayDates: OCT_SUNDAYS, activeSatDates, historyEntries: [], year: 2026, month: 10,
  });
  if (!built.ok) throw new Error(`refused: ${built.reason}`);
  return built;
}

describe("isSaturdayFloor", () => {
  it("is a Saturday-only pattern asking for at least one seat", () => {
    for (const pattern of ["Sat.*", "Sat.Lead", "Sat.BGV"]) {
      expect(isSaturdayFloor(cap(pattern, "==", 1), 4)).toBe(true);
      expect(isSaturdayFloor(cap(pattern, ">=", 2), 4)).toBe(true);
    }
  });

  it("is never a maximum, a zero, or a pattern that includes Sunday roles", () => {
    expect(isSaturdayFloor(cap("Sat.*", "<=", 1), 4)).toBe(false);
    expect(isSaturdayFloor(cap("Sat.*", "==", 0), 4)).toBe(false);
    expect(isSaturdayFloor(cap("Sat.*", ">=", 0), 4)).toBe(false);
    for (const pattern of ["Sun.*", "*.*", "*.Lead", "*.BGV", "*.LeadBGV", "Sun.Lead"]) {
      expect(isSaturdayFloor(cap(pattern, ">=", 1), 4)).toBe(false);
    }
  });

  it("resolves a relative value the way the solver does, max(0, weeks - offset)", () => {
    expect(isSaturdayFloor(cap("Sat.*", "==", 0, 2), 4)).toBe(true); // {weeks-2} = 2
    expect(isSaturdayFloor(cap("Sat.*", "==", 0, 4), 4)).toBe(false); // {weeks-4} = 0
    expect(isSaturdayFloor(cap("Sat.*", "==", 0, 6), 4)).toBe(false); // clamped to 0
  });
});

describe("buildSolveRequest in a month with no Saturday for Auto", () => {
  const rules = [
    restriction("Andy", [cap("Sun.*", "==", 1), cap("Sat.*", "==", 1)], { excludedPatterns: ["Sun.BGV"], fairness: "slack", fairnessSlack: 3 }),
    restriction("Tay", [cap("Sat.*", "==", 1), cap("Sun.*", "==", 1)]),
  ];

  it("leaves the Saturday minimums out, keeps every other clause, and says which it left", () => {
    // Frank's grid: the only Saturday selected is 31 Oct, and its only lead is away that
    // day, so T5 withholds it and Auto has no Saturday this month.
    const built = solve(rules, ["2026-10-31"], frankAwayOn31);
    expect(built.request.weekends_with_saturday).toEqual([]);
    expect(built.trailing).toEqual({ date: "2026-10-31", sent: false, reason: "noLead" });
    expect(built.request.dsl_rules).toContain("Andy !in Sun.BGV & Sun.* == 1 & fairness_slack 3");
    expect(built.request.dsl_rules).toContain("Tay Sun.* == 1");
    expect(built.request.dsl_rules.join("\n")).not.toContain("Sat.* == 1");
    expect(built.omittedCaps).toEqual([
      { person: "Andy", cap: "Sat.* == 1", reason: "noSaturday" },
      { person: "Tay", cap: "Sat.* == 1", reason: "noSaturday" },
    ]);
  });

  it("does the same with no Saturday selected at all", () => {
    const { omittedCaps } = solve(rules, []);
    expect(omittedCaps).toHaveLength(2);
    expect(omittedCaps.every((o) => o.reason === "noSaturday")).toBe(true);
  });

  // D16 amended by ADR-0048 (T1/T5): the 31st is week 5, sent when a lead can take it.
  it("keeps the minimums when the 31st is the only Saturday and a lead can take it", () => {
    const built = solve(rules, ["2026-10-31"]);
    expect(built.request.weekends_with_saturday).toEqual([5]);
    expect(built.trailing).toEqual({ date: "2026-10-31", sent: true });
    expect(built.request.dsl_rules).toContain("Andy !in Sun.BGV & Sun.* == 1 & Sat.* == 1 & fairness_slack 3");
    expect(built.request.dsl_rules).toContain("Tay Sat.* == 1 & Sun.* == 1");
    expect(built.omittedCaps).toEqual([]);
  });

  it("keeps the minimums untouched in a month that has a Saturday Auto can staff", () => {
    const built = solve(rules, ["2026-10-17", "2026-10-31"]);
    // D16 amended by ADR-0048 (T1/T5): the 31st is week 5 and Frank can lead it.
    expect(built.request.weekends_with_saturday).toEqual([3, 5]);
    expect(built.request.dsl_rules).toContain("Andy !in Sun.BGV & Sun.* == 1 & Sat.* == 1 & fairness_slack 3");
    expect(built.request.dsl_rules).toContain("Tay Sat.* == 1 & Sun.* == 1");
    expect(built.omittedCaps).toEqual([]);
  });

  it("keeps a Saturday maximum, which holds trivially, and a rule left with no clause disappears", () => {
    const built = solve([
      restriction("Andy", [cap("Sat.*", "<=", 1)]),
      restriction("Tay", [cap("Sat.Lead", ">=", 1)]),
    ], []);
    expect(built.request.dsl_rules).toContain("Andy Sat.* <= 1");
    expect(built.request.dsl_rules.some((r) => r.startsWith("Tay "))).toBe(false);
    expect(built.omittedCaps).toEqual([{ person: "Tay", cap: "Sat.Lead >= 1", reason: "noSaturday" }]);
  });

  it("reports a relative minimum the way the rules card shows it, not in DSL template form", () => {
    const built = solve([restriction("Andy", [cap("Sat.BGV", "==", 0, 2)])], []);
    expect(built.omittedCaps).toEqual([{ person: "Andy", cap: "Sat.BGV == sem−2", reason: "noSaturday" }]);
    expect(built.request.dsl_rules.join("\n")).not.toContain("Sat.BGV");
  });
});

describe("capText / capLabel", () => {
  it("capText writes the solver's DSL; capLabel writes what the rules card shows", () => {
    expect(capText(cap("Sat.*", "==", 1))).toBe("Sat.* == 1");
    expect(capText(cap("Sun.BGV", "<=", 0, 2))).toBe("Sun.BGV <= {weeks-2}");
    expect(capLabel(cap("Sat.*", "==", 1))).toBe("Sat.* == 1");
    expect(capLabel(cap("Sun.BGV", "<=", 0, 2))).toBe("Sun.BGV <= sem−2");
  });
});

describe("omittedCapsNotices (noSaturday)", () => {
  it("is empty when nothing was left out", () => {
    expect(omittedCapsNotices([])).toEqual([]);
  });

  it("groups people under each rule, in Spanish — today's sentence, unchanged", () => {
    expect(omittedCapsNotices([
      { person: "Andy", cap: "Sat.* == 1", reason: "noSaturday" },
      { person: "Tay", cap: "Sat.* == 1", reason: "noSaturday" },
      { person: "Vale 𑣲⋆", cap: "Sat.* == 1", reason: "noSaturday" },
    ])).toEqual(["Este mes no tiene sábados que Auto pueda cubrir, así que no se aplicó «Sat.* == 1» a Andy, Tay y Vale 𑣲⋆."]);
    expect(omittedCapsNotices([
      { person: "Andy", cap: "Sat.* == 1", reason: "noSaturday" },
      { person: "Tay", cap: "Sat.Lead >= 1", reason: "noSaturday" },
    ])).toEqual(["Este mes no tiene sábados que Auto pueda cubrir, así que no se aplicó «Sat.* == 1» a Andy y «Sat.Lead >= 1» a Tay."]);
  });

  it("names a person once per rule, however many times they were left out under it", () => {
    expect(omittedCapsNotices([
      { person: "Andy", cap: "Sat.* == 1", reason: "noSaturday" },
      { person: "Andy", cap: "Sat.* == 1", reason: "noSaturday" },
    ])).toEqual(["Este mes no tiene sábados que Auto pueda cubrir, así que no se aplicó «Sat.* == 1» a Andy."]);
  });
});

describe("solverRefusalMessage", () => {
  it("is the generic line when the solver gave no reason", () => {
    expect(solverRefusalMessage(undefined)).toBe(SOLVER_REFUSAL);
    expect(solverRefusalMessage("  ")).toBe(SOLVER_REFUSAL);
    expect(solverRefusalMessage(SOLVER_REFUSAL)).toBe(SOLVER_REFUSAL);
  });

  it("carries the solver's own reason when it gave one", () => {
    expect(solverRefusalMessage("weekends_w_sat must use 1-based indexes 1..4."))
      .toBe("El solver no encontró solución. Motivo del solver: weekends_w_sat must use 1-based indexes 1..4.");
  });
});
