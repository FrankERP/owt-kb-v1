import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyRetirementRuleChanges,
  filterMembersForSelection,
  hasLiveRuleNamingMember,
  isRetiredFrom,
  isFutureOrTodayServiceDate,
  memberIdsRetiredOnFutureService,
  mexicoCityTodayIso,
  nextRetiredFrom,
  personNameOptions,
  planWorshipRetirementRules,
  retiredInSolverPools,
  rulePersonNamesMember,
  validateRetirement,
  worshipRetireeIdsExcludedFromSolve,
  WORSHIP_NOT_RETIRED_GROQ_FILTER,
} from "../memberRetirement";
import type { SolverConfig } from "@/app/components/admin/plannerModel";

const baseConfig = (): SolverConfig => ({
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [],
  presence: [],
});

describe("memberRetirement helpers", () => {
  it("treats absent retiredFrom as serving (R1)", () => {
    expect(isRetiredFrom("worship", undefined)).toBe(false);
    expect(isRetiredFrom("worship", null)).toBe(false);
    expect(isRetiredFrom("worship", [])).toBe(false);
  });

  it("exports hidden retiredFrom on schema (R1)", () => {
    const schemaPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../sanity/schemas/worshipTeam.ts",
    );
    const src = readFileSync(schemaPath, "utf8");
    expect(src).toMatch(/name:\s*"retiredFrom"/);
    expect(src).toMatch(/hidden:\s*true/);
  });

  it("WORSHIP_NOT_RETIRED_GROQ_FILTER uses explicit absence arm", () => {
    expect(WORSHIP_NOT_RETIRED_GROQ_FILTER).toContain("!defined(retiredFrom)");
    expect(WORSHIP_NOT_RETIRED_GROQ_FILTER).toContain('"worship" in retiredFrom');
  });

  it("validateRetirement uses stored ministries via normalizeMinistries (R11)", () => {
    expect(validateRetirement({}, "worship")).toBeNull();
    expect(validateRetirement({}, "kids")).toMatch(/Oasis Kids/);
    expect(validateRetirement({ ministries: ["kids"] }, "kids")).toBeNull();
    expect(validateRetirement({ ministries: ["kids"] }, "worship")).toMatch(/Alabanza/);
  });

  it("filterMembersForSelection keeps explicitly selected ids (R2)", () => {
    const members = [
      { _id: "a", member_name: "Ana", retiredFrom: ["worship"] },
      { _id: "b", member_name: "Bob" },
    ];
    expect(filterMembersForSelection(members, "worship").map((m) => m._id)).toEqual(["b"]);
    expect(
      filterMembersForSelection(members, "worship", { keepIds: ["a"] }).map((m) => m._id),
    ).toEqual(["a", "b"]);
  });

  it("personNameOptions preserves edited rule names (R2)", () => {
    const members = [{ _id: "a", member_name: "Ana", retiredFrom: ["worship"] }];
    expect(personNameOptions(members, "worship")).toEqual([]);
    expect(personNameOptions(members, "worship", ["Ana"])).toEqual(["Ana"]);
  });

  it("nextRetiredFrom toggles ministry membership", () => {
    expect(nextRetiredFrom(undefined, "worship", true)).toEqual(["worship"]);
    expect(nextRetiredFrom(["worship"], "worship", false)).toBeUndefined();
    expect(nextRetiredFrom(["worship"], "kids", true)).toEqual(["worship", "kids"]);
  });

  it("retiredInSolverPools lists only retired ids still in pools (R16)", () => {
    const config = { ...baseConfig(), support: ["r1"] };
    const members = [
      { _id: "r1", member_name: "Ret", retiredFrom: ["worship"] },
      { _id: "a1", member_name: "Act" },
    ];
    expect(retiredInSolverPools(config, members).map((m) => m._id)).toEqual(["r1"]);
  });

  it("flags retired occupants on future services only (R6)", () => {
    const members = [{ _id: "r1", member_name: "Ret", retiredFrom: ["worship"] }];
    expect(
      memberIdsRetiredOnFutureService(["r1"], "2026-09-01", members, "2026-08-31"),
    ).toEqual(["r1"]);
    expect(
      memberIdsRetiredOnFutureService(["r1"], "2026-08-30", members, "2026-08-31"),
    ).toEqual([]);
  });

  it("mexicoCityTodayIso returns YYYY-MM-DD", () => {
    expect(mexicoCityTodayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isFutureOrTodayServiceDate("2026-08-31", "2026-08-31")).toBe(true);
    expect(isFutureOrTodayServiceDate("2026-08-30", "2026-08-31")).toBe(false);
  });
});

describe("memberIdToName with retired member still in list (R3)", () => {
  it("resolves id when member is retired but present in unfiltered list", async () => {
    const { memberIdToName } = await import("@/app/components/admin/plannerModel");
    const members = [{ _id: "x", member_name: "Ana", retiredFrom: ["worship"] }];
    expect(memberIdToName("x", members)).toBe("Ana");
  });
});

describe("rankCandidates excludes retired from new selection (R2)", () => {
  it("omits retired members from ranking", async () => {
    const { rankCandidates } = await import("@/app/components/admin/candidateRanking");
    const LEAD = { id: "lead", label: "Lead", category: "voz" as const, memberType: "voz", target: 1, max: 1 };
    const ranked = rankCandidates({
      seat: LEAD,
      date: "2026-09-07",
      members: [
        { _id: "a", member_name: "Active", memberType: ["voz"] },
        { _id: "r", member_name: "Retired", memberType: ["voz"], retiredFrom: ["worship"] },
      ],
      windowRoles: [],
      assigned: [],
    });
    expect(ranked.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("P3 worship retirement rules (R15/R17)", () => {
  const member = { member_name: "Ana", alias: "Anita" };

  it("rulePersonNamesMember matches alias or member_name", () => {
    expect(rulePersonNamesMember("Ana", member)).toBe(true);
    expect(rulePersonNamesMember("anita", member)).toBe(true);
    expect(rulePersonNamesMember("Bob", member)).toBe(false);
  });

  it("solo restriction → auto delete without confirmation", () => {
    const config = {
      ...baseConfig(),
      restrictions: [{
        id: "r1", person: "Anita", excludedPatterns: ["Sat.*"],
        fairness: "none" as const, fairnessSlack: 0, weekExclusions: [], caps: [],
      }],
    };
    const plan = planWorshipRetirementRules(config, member);
    expect(plan.confirm).toHaveLength(0);
    expect(plan.auto).toHaveLength(1);
    expect(plan.auto[0].kind).toBe("delete");
  });

  it("conflict naming retiree → requires confirmation (R15)", () => {
    const config = {
      ...baseConfig(),
      conflicts: [{ id: "c1", personA: "Anita", personB: "Bob", pattern: "Sun.*" }],
    };
    const plan = planWorshipRetirementRules(config, member);
    expect(plan.confirm).toHaveLength(1);
    expect(plan.confirm[0].affectedOthers).toEqual(["Bob"]);
  });

  it("presence of three → edit with confirmation", () => {
    const config = {
      ...baseConfig(),
      presence: [{ id: "p1", persons: ["Anita", "Bob", "Carol"], pattern: "Sun.*" }],
    };
    const plan = planWorshipRetirementRules(config, member);
    expect(plan.confirm).toHaveLength(1);
    expect(plan.confirm[0].kind).toBe("edit_presence");
    expect(plan.confirm[0].editedPersons).toEqual(["Bob", "Carol"]);
  });

  it("presence of two → delete with confirmation", () => {
    const config = {
      ...baseConfig(),
      presence: [{ id: "p1", persons: ["Anita", "Bob"], pattern: "Sun.*" }],
    };
    const plan = planWorshipRetirementRules(config, member);
    expect(plan.confirm[0].kind).toBe("delete");
  });

  it("applyRetirementRuleChanges removes resolved rules (R10.f path)", () => {
    const config = {
      ...baseConfig(),
      support: ["a1"],
      restrictions: [{
        id: "r1", person: "Anita", excludedPatterns: ["Sat.*"],
        fairness: "none" as const, fairnessSlack: 0, weekExclusions: [], caps: [],
      }],
      presence: [{ id: "p1", persons: ["Anita", "Bob", "Carol"], pattern: "Sun.*" }],
    };
    const plan = planWorshipRetirementRules(config, member);
    const next = applyRetirementRuleChanges(config, [...plan.auto, ...plan.confirm]);
    expect(next.restrictions).toHaveLength(0);
    expect(next.presence[0].persons).toEqual(["Bob", "Carol"]);
    expect(hasLiveRuleNamingMember(next, member)).toBe(false);
  });

  it("worshipRetireeIdsExcludedFromSolve defers while live rule names member", () => {
    const members = [{ _id: "a1", member_name: "Ana", alias: "Anita", retiredFrom: ["worship"] as const }];
    const withRule = {
      ...baseConfig(),
      restrictions: [{
        id: "r1", person: "Anita", excludedPatterns: ["Sat.*"],
        fairness: "none" as const, fairnessSlack: 0, weekExclusions: [], caps: [],
      }],
    };
    expect(worshipRetireeIdsExcludedFromSolve(members, withRule).has("a1")).toBe(false);
    expect(worshipRetireeIdsExcludedFromSolve(members, baseConfig()).has("a1")).toBe(true);
  });
});
