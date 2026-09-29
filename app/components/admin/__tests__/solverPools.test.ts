// app/components/admin/__tests__/solverPools.test.ts
import { describe, expect, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import { buildSolveRequest, resolvedCapValue, solverPools, type SolverConfig } from "../plannerModel";

const m = (id: string, name: string, memberType: string[], alias?: string): RankMember =>
  ({ _id: id, member_name: name, alias, memberType } as RankMember);

const ANA = m("ana", "Ana Karen Villalobos", ["voz", "sunday_lead"], "Ana");
const BETO = m("beto", "Alberto Ruiz Cano", ["voz", "saturday_lead", "sunday_lead"], "Beto");
const LU = m("lu", "María Lucía Estrada", ["voz", "support"], "Lucía");
const NIZA = m("niza", "Nizarindani Cruz Ávila", ["voz"], "Niza"); // no pool subtype: injected when a rule names her
const members = [ANA, BETO, LU, NIZA];

const config: SolverConfig = {
  sundayLeads: ["ana", "beto"],
  saturdayLeads: ["beto"],
  support: ["lu"],
  restrictions: [{ id: "r1", person: "Niza", excludedPatterns: ["Sun.Lead"], fairness: "none", fairnessSlack: 0, weekExclusions: [], caps: [] }],
  conflicts: [],
  presence: [],
};

describe("solverPools", () => {
  it("returns the names buildSolveRequest sends, deduplicated by pool priority", () => {
    const pools = solverPools(config, members);
    expect(pools.sundayLeadNames).toEqual(["Ana Karen Villalobos", "Alberto Ruiz Cano"]);
    expect(pools.saturdayLeadNames).toEqual([]); // Beto is already a Sunday lead
    expect(pools.supportNames).toEqual(["María Lucía Estrada"]);
    expect(pools.extraSupport).toEqual(["Nizarindani Cruz Ávila"]);
    expect([...pools.requestMemberIds]).toEqual(["ana", "beto", "lu", "niza"]);
    expect(pools.dslBlockedByTipo).toEqual([]);

    const built = buildSolveRequest({
      config, members, sundayDates: ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22"],
      activeSatDates: [], historyEntries: [], year: 2026, month: 3,
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.request.sunday_leads).toEqual(pools.sundayLeadNames);
    expect(built.request.saturday_leads).toEqual(pools.saturdayLeadNames);
    expect(built.request.support).toEqual([...pools.supportNames, ...pools.extraSupport]);
  });

  it("names a rule's person who has no Tipo at all", () => {
    const pools = solverPools(config, [ANA, BETO, LU, { ...NIZA, memberType: [] }]);
    expect(pools.dslBlockedByTipo).toEqual(["Niza"]);
  });
});

describe("resolvedCapValue", () => {
  it("resolves a relative cap as max(0, weeks - offset), an absolute one as its value", () => {
    const cap = { id: "c", pattern: "Sat.*", op: "==" as const, value: 1, relative: false, relOffset: 2 };
    expect(resolvedCapValue(cap, 4)).toBe(1);
    expect(resolvedCapValue({ ...cap, relative: true, relOffset: 2 }, 4)).toBe(2);
    expect(resolvedCapValue({ ...cap, relative: true, relOffset: 6 }, 4)).toBe(0);
  });
});
