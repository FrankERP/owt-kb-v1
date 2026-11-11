// Solver v3 C2 RES-2 / IF2-16 — `rolesOfPatternV3`, the ONE v3 six-key pattern map,
// against `rolesOfPattern`, the ONE v2 map (which `patternRolesSync.test.ts` keeps in
// step with the solver). The relation is the contract: restricted to v2's five keys the
// two agree on every pattern, and `Sat.Choir` is added exactly when a pattern covers
// chorus on Saturday. The saveable set is `RULE_PATTERNS` (`ruleCopy.ts`), which both the rule form
// (`PATTERNS`, `EXCL_PATTERNS` in MonthGenerator.tsx) and the chat's rule edits read, so a new saveable
// pattern joins this test the day it joins the list.
import { describe, expect, it } from "vitest";

import { LEGACY_PATTERN_ALIASES, rolesOfPattern, rolesOfPatternV3 } from "../plannerModel";
import { EXCLUSION_PATTERN_ORDER, RULE_PATTERNS } from "../ruleCopy";

const SAVEABLE: string[] = [...RULE_PATTERNS];
const ALIASES = [...LEGACY_PATTERN_ALIASES.keys()];
const SAT_CHOIR_PATTERNS = new Set(["Sat.*", "*.Choir", "*.*", "Sat.Choir", "Choir.*"]);
const ALL = [...SAVEABLE, ...ALIASES, "Sat.Choir", "*.Choir", "Sun.Lead.X", "", "Sat.LeadBGV", "constructor"];

describe("rolesOfPatternV3 against rolesOfPattern (C2 RES-2)", () => {
  it("the saveable list is the eleven patterns, each picker's order covers exactly that set", () => {
    expect(SAVEABLE).toHaveLength(11);
    expect(new Set(SAVEABLE).size).toBe(11);
    expect([...EXCLUSION_PATTERN_ORDER].sort()).toEqual([...SAVEABLE].sort());
    expect(SAVEABLE).not.toContain("Sun.LeadBGV");
    expect(SAVEABLE).not.toContain("Sat.LeadBGV");
  });

  it.each(SAVEABLE)("every saveable pattern %j expands to at least one solver role", (pattern) => {
    expect(rolesOfPatternV3(pattern).length).toBeGreaterThan(0);
  });

  it.each(ALL)("restricted to v2's five keys, equals rolesOfPattern for %j", (pattern) => {
    expect(rolesOfPatternV3(pattern).filter((k) => k !== "Sat.Choir")).toEqual(rolesOfPattern(pattern));
  });

  it.each(ALL)("adds Sat.Choir exactly when %j covers chorus on Saturday", (pattern) => {
    expect(rolesOfPatternV3(pattern).includes("Sat.Choir")).toBe(SAT_CHOIR_PATTERNS.has(pattern));
  });

  it("answers in canonical role order", () => {
    expect(rolesOfPatternV3("*.*")).toEqual(["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"]);
    expect(rolesOfPatternV3("Sat.*")).toEqual(["Sat.Lead", "Sat.BGV", "Sat.Choir"]);
    expect(rolesOfPatternV3("Choir.*")).toEqual(["Sun.Choir", "Sat.Choir"]);
    expect(rolesOfPatternV3("*.LeadBGV")).toEqual(["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV"]);
    expect(rolesOfPatternV3("nonsense")).toEqual([]);
  });
});
