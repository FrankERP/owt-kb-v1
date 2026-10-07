// Solver v3 C2 RES-2 / IF2-16 — `rolesOfPatternV3`, the ONE v3 six-key pattern map,
// against `rolesOfPattern`, the ONE v2 map (which `patternRolesSync.test.ts` keeps in
// step with the solver). The relation is the contract: restricted to v2's five keys the
// two agree on every pattern, and `Sat.Choir` is added exactly when a pattern covers
// chorus on Saturday. The pattern set is read from the rule form itself (`PATTERNS` and
// `EXCL_PATTERNS` in MonthGenerator.tsx), so a new saveable pattern joins this test the
// day it joins the form.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LEGACY_PATTERN_ALIASES, rolesOfPattern, rolesOfPatternV3 } from "../plannerModel";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FORM = readFileSync(path.join(HERE, "../MonthGenerator.tsx"), "utf8");

/** The quoted pattern values of one `const NAME … = [ … ];` in the rule form. */
function formList(name: string): string[] {
  const start = FORM.indexOf(`const ${name}`);
  if (start === -1) throw new Error(`${name} not found in MonthGenerator.tsx`);
  const body = FORM.slice(start, FORM.indexOf("];", start));
  const values = name === "PATTERNS"
    ? [...body.matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1])
    : [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (values.length === 0) throw new Error(`${name} parsed empty`);
  return values;
}

const SAVEABLE = [...new Set([...formList("PATTERNS"), ...formList("EXCL_PATTERNS")])];
const ALIASES = [...LEGACY_PATTERN_ALIASES.keys()];
const SAT_CHOIR_PATTERNS = new Set(["Sat.*", "*.Choir", "*.*", "Sat.Choir", "Choir.*"]);
const ALL = [...SAVEABLE, ...ALIASES, "Sat.Choir", "*.Choir", "Sun.Lead.X", "", "Sat.LeadBGV", "constructor"];

describe("rolesOfPatternV3 against rolesOfPattern (C2 RES-2)", () => {
  it("reads a real pattern list from the rule form", () => {
    expect(SAVEABLE.length).toBeGreaterThanOrEqual(11);
    expect(SAVEABLE).toContain("*.LeadBGV");
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
