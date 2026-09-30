// app/components/admin/__tests__/patternRolesSync.test.ts
//
// `rolesOfPattern` (plannerModel.ts) restates the solver's `expand_pattern` and its
// `LEGACY_PATTERN_ALIASES` (gcf/owt_solver_v2.py) because `app/` cannot call Python
// (ruling Q3 of plan 2026-09-30-planner-trailing-saturday). T3 and T5 read it to decide
// whether a `!in` rule or a week exclusion keeps someone off a Saturday seat, so a copy
// that drifted would silently send a Saturday nobody can lead, or drop a minimum someone
// could meet. This is the guard: it reads the solver's own source and fails if either side
// is edited without the other.
//
// Two-way (fix round 1, M4). `expand_pattern` is parsed line by line into a reference
// evaluator that REFUSES any line it does not recognise, and `rolesOfPattern` must agree with
// it on every pattern the solver accepts (`VALID_PATTERNS`, parsed the same way) and on a set
// of patterns it refuses. So a new solver literal such as `Sat.LeadBGV` fails here instead of
// reading as "no restriction" on this side.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LEGACY_PATTERN_ALIASES, rolesOfPattern } from "../plannerModel";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SOLVER = readFileSync(path.join(REPO_ROOT, "gcf/owt_solver_v2.py"), "utf8");

/** The body of `NAME = <open> … <close>` at the start of a line, or a loud failure. */
function table(name: string, open: string, close: string): string {
  const start = SOLVER.search(new RegExp(`^${name} = \\${open}`, "m"));
  if (start === -1) throw new Error(`${name} not found in gcf/owt_solver_v2.py`);
  const from = SOLVER.indexOf(open, start) + 1;
  const to = SOLVER.indexOf(close === ")" ? "\n)" : close, from);
  return SOLVER.slice(from, to);
}

const quoted = (body: string) => [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const ROLE_ORDER = quoted(table("ROLE_ORDER", "[", "]"));
const ALIASES = [...table("LEGACY_PATTERN_ALIASES", "{", "}").matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)].map(
  (m) => [m[1], m[2]] as const,
);

/** A module-level constant the solver's code names: `set(ROLE_ORDER)`, or a `{…}`/`[…]` literal. */
function namedSet(name: string): string[] {
  const line = SOLVER.match(new RegExp(`^${name} = (.+)$`, "m"))?.[1]?.trim();
  if (!line) throw new Error(`${name} not found in gcf/owt_solver_v2.py`);
  if (line === "set(ROLE_ORDER)") return [...ROLE_ORDER];
  if (/^[{[].*[}\]]$/.test(line)) return quoted(line);
  throw new Error(`${name} has a shape this guard does not read: ${line}`);
}

/** Parse-time check: a solver edit this guard cannot read is a loud failure, never a skip. */
function must(ok: boolean, what: string): void {
  if (!ok) throw new Error(`patternRolesSync: ${what}`);
}

/** `expand_pattern`'s own source. */
const EXPAND = (() => {
  const start = SOLVER.indexOf("def expand_pattern(");
  if (start === -1) throw new Error("expand_pattern not found in gcf/owt_solver_v2.py");
  const end = SOLVER.indexOf("\ndef ", start + 1);
  return SOLVER.slice(start, end === -1 ? undefined : end);
})();

type Step =
  | { kind: "alias" }
  | { kind: "literal"; pattern: string; roles: string[] }
  | { kind: "suffix" }
  | { kind: "concrete" };

/**
 * `expand_pattern`, parsed into steps. Every line must be one this guard understands; an
 * unfamiliar one throws, so a new branch in the solver is a red test, never a silent skip.
 */
const STEPS: Step[] = (() => {
  const lines = EXPAND.split("\n").slice(1).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
  const steps: Step[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "pattern = LEGACY_PATTERN_ALIASES.get(pattern, pattern)") {
      steps.push({ kind: "alias" });
      continue;
    }
    const literal = line.match(/^if pattern == "([^"]+)":$/);
    if (literal) {
      const ret = lines[++i];
      const named = ret?.match(/^return set\((\w+)\)$/);
      const inline = ret?.match(/^return \{([^}]*)\}$/);
      if (named) steps.push({ kind: "literal", pattern: literal[1], roles: namedSet(named[1]) });
      else if (inline) steps.push({ kind: "literal", pattern: literal[1], roles: quoted(inline[1]) });
      else throw new Error(`expand_pattern: unreadable return for ${literal[1]}: ${ret}`);
      continue;
    }
    if (line === 'if pattern.startswith("*."):') {
      // The wildcard branch, exactly: the suffix after the first dot, matched against the
      // END of each ROLE_ORDER entry after a dot, and only a non-empty match returns.
      const body = lines.slice(i + 1, i + 5).join("\n");
      must(
        body === [
          'suffix = pattern.split(".", 1)[1]',
          'matches = {r for r in ROLE_ORDER if r.endswith(f".{suffix}")}',
          "if matches:",
          "return matches",
        ].join("\n"),
        `expand_pattern's startswith("*.") branch changed:\n${body}`,
      );
      steps.push({ kind: "suffix" });
      i += 4;
      continue;
    }
    if (line === "if pattern not in ALL_ROLE_TYPES:") {
      must(/^raise ValueError\(/.test(lines[i + 1] ?? ""), `expand_pattern's refusal changed: ${lines[i + 1]}`);
      must(lines[i + 2] === "return {pattern}", `expand_pattern's concrete-role return changed: ${lines[i + 2]}`);
      steps.push({ kind: "concrete" });
      i += 2;
      continue;
    }
    throw new Error(`expand_pattern: a line this guard does not read: ${line}`);
  }
  return steps;
})();

/** What the solver's `expand_pattern` returns, or `[]` where it raises. */
function solverRoles(input: string): string[] {
  let pattern = input;
  for (const step of STEPS) {
    if (step.kind === "alias") {
      pattern = ALIASES.find(([k]) => k === pattern)?.[1] ?? pattern;
    } else if (step.kind === "literal") {
      if (pattern === step.pattern) return step.roles;
    } else if (step.kind === "suffix") {
      if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(pattern.indexOf(".") + 1);
        const matches = ROLE_ORDER.filter((r) => r.endsWith(`.${suffix}`));
        if (matches.length > 0) return matches;
      }
    } else {
      return namedSet("ALL_ROLE_TYPES").includes(pattern) ? [pattern] : [];
    }
  }
  throw new Error("expand_pattern fell through without returning");
}

/**
 * `VALID_PATTERNS`, the patterns the solver's DSL accepts, parsed as a `|`-union of the four
 * term shapes it is made of today. Any other term throws.
 */
const VALID_PATTERNS: string[] = (() => {
  const terms = table("VALID_PATTERNS", "(", ")").split("|").map((t) => t.trim()).filter((t) => t.length > 0);
  const out: string[] = [];
  for (const term of terms) {
    if (term === "ALL_ROLE_TYPES") out.push(...namedSet("ALL_ROLE_TYPES"));
    else if (term === "set(LEGACY_PATTERN_ALIASES.keys())") out.push(...ALIASES.map(([k]) => k));
    else if (term === `{f"*.{r.split('.', 1)[1]}" for r in ROLE_ORDER}`) out.push(...ROLE_ORDER.map((r) => `*.${r.split(".")[1]}`));
    else if (/^\{"[^}]*\}$/.test(term)) out.push(...quoted(term));
    else throw new Error(`VALID_PATTERNS has a term this guard does not read: ${term}`);
  }
  return [...new Set(out)];
})();

const sorted = (xs: readonly string[]) => [...xs].sort();

/** Patterns the solver raises on — `rolesOfPattern` must answer `[]`, never a guess. */
const REFUSED = ["Sat.Choir", "*.Foo", "*.", "*.Sun.Lead", "*.ead", "Foo.*", "Sat", "", "constructor", "toString", "Lead*"];

describe("rolesOfPattern mirrors the solver's expand_pattern", () => {
  it("reads non-empty tables out of the solver (a regex miss must fail, not pass vacuously)", () => {
    expect(ROLE_ORDER).toEqual(["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"]);
    expect(ALIASES.length).toBeGreaterThan(0);
    expect(STEPS.map((s) => s.kind)).toContain("suffix");
    expect(STEPS.filter((s) => s.kind === "literal").length).toBeGreaterThan(0);
    expect(VALID_PATTERNS.length).toBeGreaterThan(ROLE_ORDER.length);
  });

  it("every pattern the solver accepts covers at least one role here", () => {
    for (const pattern of VALID_PATTERNS) expect(rolesOfPattern(pattern).length, pattern).toBeGreaterThan(0);
  });

  it("agrees with the solver's expand_pattern on every accepted pattern, alias target and refused probe", () => {
    const probes = new Set([...VALID_PATTERNS, ...ALIASES.flat(), ...REFUSED]);
    for (const pattern of probes) expect(sorted(rolesOfPattern(pattern)), pattern).toEqual(sorted(solverRoles(pattern)));
    for (const pattern of REFUSED) expect(rolesOfPattern(pattern), pattern).toEqual([]);
  });

  it("*.* is every role, in the solver's ROLE_ORDER", () => {
    expect(rolesOfPattern("*.*")).toEqual(ROLE_ORDER);
  });

  it("the legacy alias table is the solver's, both ways", () => {
    expect(sorted([...LEGACY_PATTERN_ALIASES].map(([k, v]) => `${k}→${v}`))).toEqual(sorted(ALIASES.map(([k, v]) => `${k}→${v}`)));
  });

  it("a pattern the solver raises on is [] — the solver's own words for it are still there", () => {
    expect(EXPAND).toContain("Unsupported restriction pattern");
  });
});
