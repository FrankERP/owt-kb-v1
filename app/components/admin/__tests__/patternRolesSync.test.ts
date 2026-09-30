// app/components/admin/__tests__/patternRolesSync.test.ts
//
// `rolesOfPattern` (plannerModel.ts) restates the solver's `expand_pattern` and its
// `LEGACY_PATTERN_ALIASES` (gcf/owt_solver_v2.py) because `app/` cannot call Python
// (ruling Q3 of plan 2026-09-30-planner-trailing-saturday). T3 and T5 read it to decide
// whether a `!in` rule or a week exclusion keeps someone off a Saturday seat, so a copy
// that drifted would silently send a Saturday nobody can lead, or drop a minimum someone
// could meet. This is the guard: it reads the solver's own tables and fails if either
// side is edited without the other.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { rolesOfPattern } from "../plannerModel";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SOLVER = readFileSync(path.join(REPO_ROOT, "gcf/owt_solver_v2.py"), "utf8");

/** The body of `NAME = <open> … <close>` at the start of a line, or a loud failure. */
function table(name: string, open: string, close: string): string {
  const start = SOLVER.search(new RegExp(`^${name} = \\${open}`, "m"));
  if (start === -1) throw new Error(`${name} not found in gcf/owt_solver_v2.py`);
  const from = SOLVER.indexOf(open, start) + 1;
  const to = SOLVER.indexOf(close, from);
  return SOLVER.slice(from, to);
}

const quoted = (body: string) => [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const ROLE_ORDER = quoted(table("ROLE_ORDER", "[", "]"));
const LEAD_BGV_ROLES = quoted(table("LEAD_BGV_ROLES", "{", "}"));
const ALIASES = [...table("LEGACY_PATTERN_ALIASES", "{", "}").matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)].map(
  (m) => [m[1], m[2]] as const,
);

/** `expand_pattern`'s own source, so each literal special case can be read back out. */
const EXPAND = (() => {
  const start = SOLVER.indexOf("def expand_pattern(");
  if (start === -1) throw new Error("expand_pattern not found in gcf/owt_solver_v2.py");
  const end = SOLVER.indexOf("\ndef ", start + 1);
  return SOLVER.slice(start, end === -1 ? undefined : end);
})();

/** `if pattern == "X":\n  return {…}` → the literal set, read from the solver. */
function literalCase(pattern: string): string[] {
  const esc = pattern.replace(/[.*]/g, (c) => `\\${c}`);
  const hit = EXPAND.match(new RegExp(`if pattern == "${esc}":\\s*return \\{([^}]*)\\}`));
  if (!hit) throw new Error(`expand_pattern has no literal case for ${pattern}`);
  return quoted(hit[1]);
}

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("rolesOfPattern mirrors the solver's expand_pattern", () => {
  it("reads non-empty tables out of the solver (a regex miss must fail, not pass vacuously)", () => {
    expect(ROLE_ORDER).toEqual(["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"]);
    expect(LEAD_BGV_ROLES.length).toBe(4);
    expect(ALIASES.length).toBeGreaterThan(0);
    expect(EXPAND).toContain("LEGACY_PATTERN_ALIASES.get(pattern, pattern)");
  });

  it("*.* is every role, in the solver's ROLE_ORDER", () => {
    expect(EXPAND).toMatch(/if pattern == "\*\.\*":\s*return set\(ROLE_ORDER\)/);
    expect(rolesOfPattern("*.*")).toEqual(ROLE_ORDER);
  });

  it("Sun.* and Sat.* are the solver's literal sets", () => {
    expect(sorted(rolesOfPattern("Sun.*"))).toEqual(sorted(literalCase("Sun.*")));
    expect(sorted(rolesOfPattern("Sat.*"))).toEqual(sorted(literalCase("Sat.*")));
    expect(rolesOfPattern("Sat.*")).toEqual(["Sat.Lead", "Sat.BGV"]);
  });

  it("*.LeadBGV is LEAD_BGV_ROLES", () => {
    expect(EXPAND).toMatch(/if pattern == "\*\.LeadBGV":\s*return set\(LEAD_BGV_ROLES\)/);
    expect(sorted(rolesOfPattern("*.LeadBGV"))).toEqual(sorted(LEAD_BGV_ROLES));
  });

  it("*.<role> is every ROLE_ORDER entry with that suffix", () => {
    const suffixes = [...new Set(ROLE_ORDER.map((r) => r.split(".")[1]))];
    expect(suffixes).toEqual(["Lead", "BGV", "Choir"]);
    for (const suffix of suffixes) {
      expect(rolesOfPattern(`*.${suffix}`)).toEqual(ROLE_ORDER.filter((r) => r.endsWith(`.${suffix}`)));
    }
  });

  it("a concrete role is itself", () => {
    for (const role of ROLE_ORDER) expect(rolesOfPattern(role)).toEqual([role]);
  });

  it("every legacy alias expands exactly as its target does", () => {
    for (const [alias, target] of ALIASES) {
      expect(rolesOfPattern(alias), alias).toEqual(rolesOfPattern(target));
      expect(rolesOfPattern(alias).length, alias).toBeGreaterThan(0);
    }
  });

  it("a pattern the solver raises on is [] — never a guess", () => {
    for (const bad of ["Sat.Choir", "*.Foo", "Foo.*", "Sat", "", "constructor", "toString"]) {
      expect(rolesOfPattern(bad), bad).toEqual([]);
    }
    // The solver's own words for it, so this list tracks a real refusal, not a local rule.
    expect(EXPAND).toContain("Unsupported restriction pattern");
  });
});
