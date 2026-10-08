// Solver v3 C6 §4, RQ-2, ST-8 — each horizon month's state comes from IF2-8 alone; a bound month is
// solved from its record, every other month from IF2-15 over the on-screen config and members AS-IS;
// per-service eligibility is derived from that one source.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EligibilityResult } from "@/app/utils/fairnessEligibility";

const h = vi.hoisted(() => ({ result: null as null | EligibilityResult }));
vi.mock("@/app/utils/fairnessEligibility", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/app/utils/fairnessEligibility")>();
  return { ...real, resolveMonthEligibility: (input: Parameters<typeof real.resolveMonthEligibility>[0]) => h.result ?? real.resolveMonthEligibility(input) };
});

import {
  bodyFromRecord, dayClass, displayedMonthStates, monthStateOf, resolveMonthSources, rolesOfService, serviceEligibility,
} from "../v3MonthSources";
import { ALL_IN, ANA, BRUNO, MEMBERS, cap, config, ledgerResponse, record, restriction } from "./v3Fixtures";

afterEach(() => { h.result = null; });

const anaRecord = record("2026-11", [{
  memberId: "m-ana", name: "Ana", roles: { ...ALL_IN, "Sat.Lead": "out" }, exactRules: [], exempt: false,
  blocks: [{ date: "2026-11-15", unavailable: true, excludedRoles: [] }, { date: "2026-11-08", unavailable: false, excludedRoles: ["Sun.Lead"] }],
}]);

describe("monthStateOf — §4's table, read from IF2-8 (never re-derived)", () => {
  it("bound / recorded, unbound / anchored, unrecorded / unrecorded", () => {
    expect(monthStateOf({ month: "2026-11", record: anaRecord, storedServices: 2, recordBinds: true })).toBe("bound");
    expect(monthStateOf({ month: "2026-11", record: anaRecord, storedServices: 0, recordBinds: false })).toBe("recorded_unbound");
    expect(monthStateOf({ month: "2026-11", record: null, storedServices: 3, recordBinds: false })).toBe("anchored_unrecorded");
    expect(monthStateOf({ month: "2026-11", record: null, storedServices: 0, recordBinds: false })).toBe("unrecorded");
  });

  it("a month whose only stored service is an uncounted special is not anchored (IF2-8 counts it out)", () => {
    // C2 IF2-24: freezing services are weekend services and COUNTED specials, so the GET reports 0.
    expect(monthStateOf({ month: "2026-12", record: null, storedServices: 0, recordBinds: false })).toBe("unrecorded");
  });

  it("before any read answers, every month is shown as not bound (banners and gates err toward showing)", () => {
    expect([...displayedMonthStates(["2026-11", "2026-12"], null).values()]).toEqual(["unrecorded", "unrecorded"]);
  });
});

describe("bodyFromRecord — a bound month's source", () => {
  it("is the record's people without names, and its presence as read", () => {
    const body = bodyFromRecord(anaRecord);
    expect(body.month).toBe("2026-11");
    expect(body.people[0]).not.toHaveProperty("name");
    expect(body.people[0].memberId).toBe("m-ana");
    expect(body.presence).toEqual([]);
  });
});

describe("resolveMonthSources (RQ-2, ST-8)", () => {
  const screen = config({ sundayLeads: ["m-ana", "m-bruno"], support: ["m-dani"] });

  it("a bound month ignores an on-screen pool change; a recorded, unbound month follows it and keeps the rev read", () => {
    const ledger = ledgerResponse(["2026-11", "2026-12"], {
      horizon: [
        { record: anaRecord, storedServices: 1, recordBinds: true },
        { record: record("2026-12", []), storedServices: 0, recordBinds: false },
      ],
    });
    const out = resolveMonthSources({ months: ["2026-11", "2026-12"], ledger, config: screen, members: MEMBERS, exactLeadLabel: () => null });
    if (!out.ok) throw new Error(out.lines.join("\n"));
    const [nov, dec] = out.sources;
    expect(nov.state).toBe("bound");
    expect(nov.body.people.map((p) => p.memberId)).toEqual(["m-ana"]);           // the record, not the screen
    expect(nov.rev).toBe("rev-2026-11");
    expect(dec.state).toBe("recorded_unbound");
    expect(dec.rev).toBe("rev-2026-12");
    expect(dec.body.people.some((p) => p.memberId === "m-bruno")).toBe(true);    // the screen's pools
  });

  it("the source is frozen: mutating the body the request and the record share throws", () => {
    const out = resolveMonthSources({ months: ["2026-11"], ledger: ledgerResponse(["2026-11"]), config: screen, members: MEMBERS, exactLeadLabel: () => null });
    if (!out.ok) throw new Error("expected ok");
    expect(() => { (out.sources[0].body.people as unknown[]).push({}); }).toThrow();
  });

  it.each([
    ["unresolved", "No se puede correr Auto: «Ana» en las reglas no coincide con nadie. Corrige el nombre en la regla."],
    ["ambiguous", "No se puede correr Auto: «Ana» en las reglas coincide con más de una persona. Corrige el nombre en la regla."],
    ["no_tipo", "No se puede correr Auto: «Ana» en las reglas no tiene Tipo. Corrige el nombre en la regla."],
    ["cadence_and_exact", "No se puede correr Auto: Ana tiene «Mes por medio» y además un número fijo de Dom Lead («Ana · Sun.Lead == 2»). Quita una de las dos."],
    ["overlapping_exact", "No se puede correr Auto: Ana tiene dos números fijos para el mismo rol. Deja una sola regla."],
    ["exact_count_range", "No se puede correr Auto: la regla fija de Ana no da un número entero de 0 a 31 lugares en noviembre. Corrígela."],
    ["presence_member_not_listed", "No se puede correr Auto: Ana está en una regla de presencia pero no canta (su Tipo no incluye voz). Corrige la regla o su Tipo."],
  ] as const)("a resolver refusal «%s» refuses with its §7.9 line", (reason, line) => {
    h.result = { ok: false, issues: [], refusals: [{ person: "Ana", reason }] };
    const out = resolveMonthSources({ months: ["2026-11"], ledger: ledgerResponse(["2026-11"]), config: screen, members: MEMBERS, exactLeadLabel: () => "Ana · Sun.Lead == 2" });
    expect(out).toEqual({ ok: false, lines: [line] });
  });

  it.each(["no_people", "too_many_people", "too_many_presence", "presence_rule_id", "presence_roles", "presence_members"] as const)(
    "a resolver issue «%s» refuses with its §7.9 line and never renders the issue's ruleKey",
    (code) => {
      h.result = { ok: false, issues: [{ code, ruleKey: "d-carla-dani" }], refusals: [] };
      const out = resolveMonthSources({ months: ["2026-11"], ledger: ledgerResponse(["2026-11"]), config: screen, members: MEMBERS, exactLeadLabel: () => null });
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.lines).toHaveLength(1);
        expect(out.lines[0]).toMatch(/^No se puede correr Auto: /);
        expect(out.lines[0]).not.toContain("d-carla-dani");
      }
    },
  );

  it("a super-admin roster with a kids-only namesake of a rule person is passed as-is and refuses nothing (C3 E25, RES-5)", () => {
    const kidsAna = { _id: "m-ana-kids", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz"], ministries: ["kids"] };
    const withCap = config({
      sundayLeads: ["m-ana", "m-bruno"],
      restrictions: [restriction("r-ana", "Ana", { caps: [cap("c-ana", "Sun.Lead", "==", 2)] })],
    });
    const out = resolveMonthSources({ months: ["2026-11"], ledger: ledgerResponse(["2026-11"]), config: withCap, members: [...MEMBERS, kidsAna], exactLeadLabel: () => null });
    if (!out.ok) throw new Error(out.lines.join("\n"));
    const ana = out.sources[0].body.people.find((p) => p.memberId === "m-ana");
    expect(ana?.exactRules).toEqual([{ roles: ["Sun.Lead"], count: 2 }]);
    expect(out.sources[0].body.people.some((p) => p.memberId === "m-ana-kids")).toBe(false);
  });
});

describe("per-service eligibility (RQ-2), from the month source alone", () => {
  const source = { month: "2026-11", state: "bound" as const, rev: "r", recordedAt: null, body: bodyFromRecord(anaRecord) };

  it("in or exact is eligible, out is not; the day class picks the role key", () => {
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-01", kind: "sunday", fixed: false }, [])).toEqual(["Lead", "BGV", "Choir"]);
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-07", kind: "saturday", fixed: false }, [])).toEqual(["BGV"]);
    expect(dayClass("special", "2026-11-22")).toBe("Sun");
    expect(dayClass("special", "2026-11-20")).toBe("Sat");
  });

  it("unavailable by the source's block or by live unavailableDates (F4)", () => {
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-15", kind: "sunday", fixed: false }, [])).toEqual([]);
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-22", kind: "sunday", fixed: false }, ["2026-11-22"])).toEqual([]);
  });

  it("a rule exclusion binds a weekend service only, never a special (A13)", () => {
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-08", kind: "sunday", fixed: false }, [])).toEqual(["BGV", "Choir"]);
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-08", kind: "special", fixed: true }, [])).toContain("Lead");
  });

  it("a non-fixed Saturday has no Choir; a person absent from the source is eligible for nothing", () => {
    expect(rolesOfService("saturday", false)).toEqual(["Lead", "BGV"]);
    expect(rolesOfService("saturday", true)).toEqual(["Lead", "BGV", "Choir"]);
    expect(serviceEligibility(source, BRUNO._id, { date: "2026-11-01", kind: "sunday", fixed: false }, [])).toEqual([]);
    expect(ANA._id).toBe("m-ana");
  });
});
