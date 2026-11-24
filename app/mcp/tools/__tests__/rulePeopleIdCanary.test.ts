// ADR-0092 (C1 §3.3): the id canary. With the rules stored as member ids (`personTokens: "id"`), a
// roster of realistic ids (22- and 36-character), a deleted member and a member outside Alabanza, the
// rules travel the REAL read boundary (`readRules` → `solverConfigGetBody` → `rulePeopleToNames`) into
// `get_solver_rules`, `solve_month` (refusing on the deleted member and on a member with no Tipo), the
// rule card's sentences and the rename warnings. No fixture id may appear in any of them: the canary
// checks the boundary, not a list of printers. Fictitious people only (the repository is public).
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test", useCdn: false }));

const IDS = vi.hoisted(() => ({
  ana: "A7nA9x2LmQ4rT8vW1yZ3bC",
  bruno: "6f0d2c1e-9a8b-4c7d-8e6f-5a4b3c2d1e0f",
  carla: "Cq3Rl8Ts5Uv2Wx9Yz1Ab4D",
  dani: "Dn5Vg7Hj2Kl9Mn3Pq8Rs1T",
  eva: "Ev4Xy6Zw8Tu1Sr3Qp5On7M",
  kim: "Kk2Ii4Mm6Kk8Ii0Mm2Kk4K",
  gone: "Gn0Gn1Gn2Gn3Gn4Gn5Gn6G",
}));

const DOC = vi.hoisted(() => {
  const r = (key: string, person: string, caps: unknown[] = []) => ({
    _type: "solverRestriction", _key: key, id: key, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps,
  });
  return {
    _id: "solverConfig",
    _type: "solverConfig",
    _rev: "rules-rev-1",
    personTokens: "id",
    sundayLeads: [IDS.ana, IDS.bruno],
    saturdayLeads: [IDS.carla],
    support: [IDS.dani],
    restrictions: [
      r("k-ana", IDS.ana, [{ _type: "solverCap", _key: "c1", id: "c1", pattern: "Sun.Lead", op: "<=", value: 2, relative: false, relOffset: 0 }]),
      r("k-eva", IDS.eva),
      r("k-gone", IDS.gone),
    ],
    conflicts: [{ _type: "solverConflict", _key: "x1", id: "x1", personA: IDS.bruno, personB: IDS.kim, pattern: "*.*" }],
    presence: [{ _type: "solverPresence", _key: "p1", id: "p1", persons: [IDS.ana, IDS.bruno], pattern: "Sun.BGV" }],
  };
});

const MEMBERS = vi.hoisted(() => [
  { _id: IDS.ana, member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"], ministries: ["worship"] },
  { _id: IDS.bruno, member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "sunday_lead"] },
  { _id: IDS.carla, member_name: "Carla Soto", alias: "Carla", memberType: ["voz", "saturday_lead"], ministries: ["worship"] },
  { _id: IDS.dani, member_name: "Dani Vega", alias: "Dani", memberType: ["voz", "support"], ministries: ["worship"] },
  { _id: IDS.eva, member_name: "Eva Luna", alias: "Eva", memberType: [], ministries: ["worship"] },
  { _id: IDS.kim, member_name: "Kim Kids", alias: "Kim", ministries: ["kids"] },
]);

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: {
    fetch: vi.fn(async (query: string) => (query.includes(`_type == "teamMembers"`) ? MEMBERS : DOC)),
  },
}));

import { readRules } from "@/app/utils/v3MonthPlanReads";
import { presentSolverRules } from "../getSolverRules";
import { solveMonthResult } from "../solveMonth";
import { sources } from "@/app/utils/__tests__/v3MonthPlanFixtures";
import { orphanRuleWarnings, planRuleRename } from "@/app/utils/memberRuleRename";
import type { V3PlanSources } from "@/app/utils/v3MonthPlanReads";
import { PRINCIPAL, solveDeps, textOf } from "./monthToolFixtures";

const ALL_IDS = Object.values(IDS);
const leaks = (value: unknown) => {
  const text = JSON.stringify(value);
  return ALL_IDS.filter((id) => text.includes(id));
};

describe("the id canary (ADR-0092)", () => {
  it("readRules answers names only", async () => {
    const { config } = await readRules();
    expect(leaks(config.restrictions)).toEqual([]);
    expect(leaks(config.conflicts)).toEqual([]);
    expect(leaks(config.presence)).toEqual([]);
    expect(config.restrictions.map((r) => r.person)).toEqual(["Ana", "Eva", "persona que ya no está en Alabanza"]);
    expect(config.conflicts[0]).toMatchObject({ personA: "Bruno", personB: "Kim (fuera de Alabanza)" });
  });

  it("get_solver_rules prints no id", async () => {
    const { config } = await readRules();
    expect(leaks(presentSolverRules(config, MEMBERS as never))).toEqual([]);
  });

  it("solve_month refuses on the deleted member and the member with no Tipo, naming no id", async () => {
    const rules = await readRules();
    const value: V3PlanSources = sources({ members: MEMBERS as unknown as V3PlanSources["members"], rules: { rev: rules.rev, config: rules.config } });
    const out = await solveMonthResult({ month: "2026-12" }, PRINCIPAL, solveDeps({ reads: vi.fn(async () => ({ ok: true as const, value })) }));
    expect(out.isError).toBe(true);
    const text = textOf(out);
    expect(text).toContain("ya no está en Alabanza");
    expect(text).toContain("«Eva» en las reglas no tiene Tipo");
    expect(leaks(text)).toEqual([]);
    expect(leaks(out.structuredContent)).toEqual([]);
  });

  it("a rename warns about nothing and plans nothing", () => {
    expect(orphanRuleWarnings(DOC, MEMBERS as never, [{ member_name: IDS.gone }])).toEqual([]);
    expect(planRuleRename({ rulesDoc: DOC, roster: MEMBERS, selfId: IDS.ana, before: { member_name: "Ana Ruiz", alias: "Ana" }, after: { member_name: "Ana Ruiz", alias: "Anita" } })).toMatchObject({ lines: [], sets: {} });
  });
});
