// MCP proposal editor plan T2.1/E5 — the month check's judging core against the solver's own
// independent checker. `fixtures/month-check/parity.json` is generated from solved acceptance runs
// by `gcf_v3/acceptance/month_check_fixtures.py` and asserted by BOTH suites: here against
// `judgeMonthWire`, there (`gcf_v3/tests/test_month_check_parity.py`) against `checker.recompute`.
// When the solver's semantics change and the checker follows, the Python side goes red until the
// fixture is regenerated — and then this side goes red until the core follows.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { judgeMonthWire, PROTECTION_CODES, type CheckAssignments, type CheckRequest } from "../monthCheckCore";
import type { V3Rule, V3Service } from "@/app/components/admin/v3Wire";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../../../fixtures/month-check/parity.json");

interface ParityCase {
  name: string;
  base: number;
  rules_add: V3Rule[];
  services_add: V3Service[];
  eligibility_add: Record<string, Record<string, string[]>>;
  assignments: CheckAssignments;
  expected: { instances: [string, string, string][]; missed: [string, string, string][] };
}
interface ParityFixture {
  instance_families: string[];
  protection_codes: string[];
  bases: Array<{ name: string; request: CheckRequest }>;
  cases: ParityCase[];
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as ParityFixture;

// Enumerated by name here AND in the Python suite: the guard can never pass vacuously.
const INSTANCE_FAMILIES = ["count:<=", "count:>=", "count:==", "presence", "pair", "mandatory_lead"];
const CODES = [
  "sunday_cap_exceeded", "saturday_cap_exceeded", "consecutive_sundays", "voice_floor_missed",
  "dl_floor_missed", "compensation_missed", "cadence_on_missed", "cadence_off_led",
];

function requestOf(c: ParityCase): CheckRequest {
  const base = fixture.bases[c.base].request;
  return {
    ...base,
    services: [...base.services, ...c.services_add].sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1)),
    people: base.people.map((p) => ({ ...p, eligibility: { ...p.eligibility, ...(c.eligibility_add[p.id] ?? {}) } as typeof p.eligibility })),
    rules: [...base.rules, ...c.rules_add],
  };
}

describe("month check — parity with the solver's checker", () => {
  it("the fixture is the one both suites name", () => {
    expect(fixture.instance_families).toEqual(INSTANCE_FAMILIES);
    expect(fixture.protection_codes).toEqual(CODES);
    expect([...PROTECTION_CODES].sort()).toEqual([...CODES].sort());
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const out = judgeMonthWire(requestOf(c), c.assignments);
    expect(out.instances.map((x) => [x.family, x.rule, x.scope])).toEqual(c.expected.instances);
    expect(out.missed.map((x) => [x.code, x.person, x.scope])).toEqual(c.expected.missed);
  });

  it("every family and every protection is broken in some case", () => {
    const families = new Set<string>();
    const codes = new Set<string>();
    for (const c of fixture.cases) {
      const rules = requestOf(c).rules;
      for (const [family, rule] of c.expected.instances) {
        families.add(family === "count" ? `count:${(rules.find((r) => r.id === rule) as { op: string }).op}` : family);
      }
      for (const [code] of c.expected.missed) codes.add(code);
    }
    expect(INSTANCE_FAMILIES.filter((f) => !families.has(f))).toEqual([]);
    expect(CODES.filter((x) => !codes.has(x))).toEqual([]);
  });
});
