// The stored solver pools are ids ticked at some point; "Tipo" is the live
// eligibility axis (ADR-0029). They can disagree, and the disagreement is
// invisible: the pool checkbox lists are built FROM Tipo, so a member who lost
// it cannot be rendered and therefore cannot be unticked, while their id sits
// in the solverConfig document and their name reaches the solver.
//
// That is the exact hole the retirement removal would otherwise have opened on
// its only remaining path: an admin clears someone's Tipo to stop them being
// scheduled, and the solver seats them anyway.

import { describe, expect, it } from "vitest";

import { buildSolveRequest, poolTipoMismatch, type SolverConfig } from "../plannerModel";
import type { RankMember } from "../candidateRanking";

const emptyConfig: SolverConfig = {
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [],
  presence: [],
};

const member = (id: string, name: string, memberType: string[]): RankMember =>
  ({ _id: id, member_name: name, memberType }) as RankMember;

const SUNDAYS = ["2026-02-01", "2026-02-08", "2026-02-15", "2026-02-22"];

function requestFor(config: SolverConfig, members: RankMember[]) {
  const out = buildSolveRequest({
    config,
    members,
    sundayDates: SUNDAYS,
    activeSatDates: [],
    historyEntries: [],
    year: 2026,
    month: 1,
  });
  if (!out.ok) throw new Error(`buildSolveRequest refused: ${out.reason}`);
  return out.request;
}

describe("poolTipoMismatch", () => {
  const lead = member("a", "Ana", ["voz", "sunday_lead"]);
  const cleared = member("b", "Beto", []);
  const noTipoField = { _id: "c", member_name: "Cami" } as RankMember;
  const wrongSubtype = member("d", "Dani", ["voz", "support"]);

  it("reports a pool id whose member had their Tipo cleared", () => {
    const config = { ...emptyConfig, sundayLeads: ["a", "b"] };
    const out = poolTipoMismatch(config, [lead, cleared]);
    expect(out.map((m) => m._id)).toEqual(["b"]);
    expect(out[0].field).toBe("sundayLeads");
  });

  it("treats an absent Tipo field the same as an empty one", () => {
    const config = { ...emptyConfig, support: ["c"] };
    expect(poolTipoMismatch(config, [noTipoField]).map((m) => m._id)).toEqual(["c"]);
  });

  it("reports a member who has a Tipo but not the one THAT pool requires", () => {
    // Dani is voz+support: legitimate in Soporte, stale in Líder Domingo.
    const config = { ...emptyConfig, sundayLeads: ["d"], support: ["d"] };
    const out = poolTipoMismatch(config, [wrongSubtype]);
    expect(out.map((m) => m.field)).toEqual(["sundayLeads"]);
  });

  it("says nothing about a pool that agrees with Tipo", () => {
    expect(poolTipoMismatch({ ...emptyConfig, sundayLeads: ["a"] }, [lead])).toEqual([]);
  });

  it("skips an id with no member document — a different problem, nothing to offer", () => {
    expect(poolTipoMismatch({ ...emptyConfig, support: ["ghost"] }, [lead])).toEqual([]);
  });
});

describe("buildSolveRequest — a cleared Tipo really does leave the request", () => {
  it("drops a pool member whose Tipo was cleared, and keeps the eligible one", () => {
    const config = { ...emptyConfig, sundayLeads: ["a", "b"] };
    const request = requestFor(config, [
      member("a", "Ana", ["voz", "sunday_lead"]),
      member("b", "Beto", []),
    ]);
    const pools = JSON.stringify(request);
    expect(pools).toContain("Ana");
    expect(pools).not.toContain("Beto");
  });

  it("drops them from the availability rules too, not just the pools", () => {
    // The week-exclusion rules loop the pool ids; a dropped member must not
    // reappear there naming a person the solver was never told about.
    const config = { ...emptyConfig, sundayLeads: ["a"], support: ["b"] };
    const request = requestFor(config, [
      member("a", "Ana", ["voz", "sunday_lead"]),
      { ...member("b", "Beto", []), unavailableDates: [SUNDAYS[1]] } as RankMember,
    ]);
    expect(JSON.stringify(request)).not.toContain("Beto");
  });

  it("refuses the solve when clearing a Tipo empties the Sunday pool", () => {
    // Fail closed rather than silently solving with no lead: the admin cleared
    // the Tipo of the only Sunday lead, and the request cannot be honest.
    const out = buildSolveRequest({
      config: { ...emptyConfig, sundayLeads: ["b"] },
      members: [member("b", "Beto", [])],
      sundayDates: SUNDAYS,
      activeSatDates: [],
      historyEntries: [],
      year: 2026,
      month: 1,
    });
    expect(out.ok).toBe(false);
  });

  it("still sends a member whose Tipo matches the pool they are in", () => {
    const config = { ...emptyConfig, sundayLeads: ["a"], support: ["d"] };
    const request = requestFor(config, [
      member("a", "Ana", ["voz", "sunday_lead"]),
      member("d", "Dani", ["voz", "support"]),
    ]);
    expect(JSON.stringify(request)).toContain("Dani");
  });
});
