// Solver v3 C2 RES-1 … RES-8 — the eligibility resolver (IF2-15). Example tests per rule,
// per refusal and per issue; a generated-input test of RES-8's invariant (every `ok: true`
// body passes the record validator, and no kids-only member ever reaches it); and the
// viewer-independence test (a super-admin's roster and a worship admin's give one body).
// Every name is fictitious.
import { describe, expect, it } from "vitest";

import type { PersonRestriction, SolverConfig } from "@/app/components/admin/plannerModel";
import { normalizeMinistries } from "@/app/ministries";
import { resolveMonthEligibility, type EligibilityMember } from "../fairnessEligibility";
import { validateFairnessMonthWrite } from "../fairnessMonthWriteRequest";
import { shiftMonth, type RoleKey, type Status } from "../fairnessVocabulary";

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
};
const ALMA: EligibilityMember = { _id: "m-alma", member_name: "Alma Ruiz", alias: "Alma", memberType: ["voz", "sunday_lead"] };
const BRUNO: EligibilityMember = { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "saturday_lead"], ministries: ["worship"] };
const CARMEN: EligibilityMember = { _id: "m-carmen", member_name: "Carmen Soto", alias: "Carmen", memberType: ["voz", "support"], ministries: [] };
const DIEGO: EligibilityMember = { _id: "m-diego", member_name: "Diego Paz", alias: "Diego", memberType: ["voz", "sunday_lead"] };
const ROSTER = [ALMA, BRUNO, CARMEN, DIEGO];

const rule = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], ...patch,
});
const config = (patch: Partial<SolverConfig> = {}): SolverConfig => ({
  sundayLeads: ["m-alma", "m-diego"],
  saturdayLeads: ["m-bruno"],
  support: ["m-carmen"],
  restrictions: [],
  conflicts: [],
  presence: [],
  ...patch,
});
const resolve = (patch: Partial<SolverConfig> = {}, members = ROSTER, month = "2026-10") =>
  resolveMonthEligibility({ month, config: config(patch), members });
const bodyOf = (r: ReturnType<typeof resolveMonthEligibility>) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.body;
};
const personOf = (r: ReturnType<typeof resolveMonthEligibility>, id: string) => bodyOf(r).people.find((p) => p.memberId === id)!;

describe("pools → roles (RES-1)", () => {
  it("maps the Sunday, Saturday and support pools, each role only when the Tipo fits", () => {
    const r = resolve();
    expect(personOf(r, "m-alma").roles).toEqual({ "Sun.Lead": "in", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in" });
    expect(personOf(r, "m-bruno").roles).toEqual({ ...OUT, "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in" });
    expect(personOf(r, "m-carmen").roles).toEqual({ ...OUT, "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in" });
  });

  it("reads a stale tick (a pool the current Tipo does not fit) as no pool at all", () => {
    const r = resolve({ sundayLeads: ["m-alma", "m-carmen"], support: [] });
    expect(personOf(r, "m-carmen").roles).toEqual(OUT);
  });

  it("lists every voz member once — out everywhere when in no pool — and nobody without voz", () => {
    const quiet: EligibilityMember = { _id: "m-elena", member_name: "Elena", memberType: ["voz", "support"] };
    const noVoz: EligibilityMember = { _id: "m-fausto", member_name: "Fausto", memberType: ["sunday_lead"] };
    const body = bodyOf(resolve({}, [...ROSTER, quiet, noVoz]));
    expect(body.people.map((p) => p.memberId)).toEqual(["m-alma", "m-bruno", "m-carmen", "m-diego", "m-elena"]);
    expect(body.people.find((p) => p.memberId === "m-elena")!.roles).toEqual(OUT);
  });

  it("never grants eligibility from a rule (no extraSupport, Q1)", () => {
    const outsider: EligibilityMember = { _id: "m-greta", member_name: "Greta", memberType: ["voz", "support"] };
    const r = resolve({ restrictions: [rule("r1", "Greta", { excludedPatterns: ["Sat.*"] })] }, [...ROSTER, outsider]);
    expect(personOf(r, "m-greta").roles).toEqual(OUT);
  });
});

describe("exclusions, «Exenta» and the six-key expansion (RES-2)", () => {
  it("sets the covered keys out — Sat.Choir included for Sat.*", () => {
    const r = resolve({ restrictions: [rule("r1", "Alma", { excludedPatterns: ["Sat.*"], fairness: "exempt" })] });
    expect(personOf(r, "m-alma")).toMatchObject({ roles: { ...OUT, "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "in" }, exempt: true });
  });

  it("records slack as nothing (Q2, A10)", () => {
    expect(personOf(resolve({ restrictions: [rule("r1", "Alma", { fairness: "slack", fairnessSlack: 2 })] }), "m-alma").exempt).toBe(false);
  });
});

describe("exact rules (RES-3)", () => {
  const cap = (patch: object) => ({ id: "c1", pattern: "Sun.Lead", op: "==" as const, value: 2, relative: false, relOffset: 0, ...patch });

  it("makes the covered in-roles exact with the month's count", () => {
    const r = resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ pattern: "*.Lead", value: 2 })] })] });
    expect(personOf(r, "m-alma")).toMatchObject({
      roles: { "Sun.Lead": "exact", "Sat.Lead": "exact" },
      exactRules: [{ roles: ["Sun.Lead", "Sat.Lead"], count: 2 }],
    });
  });

  it("resolves a relative cap against the month's Sundays (Oct 2026: 4, Nov 2026: 5)", () => {
    const relative = { restrictions: [rule("r1", "Alma", { caps: [cap({ relative: true, relOffset: 2 })] })] };
    expect(personOf(resolve(relative, ROSTER, "2026-10"), "m-alma").exactRules).toEqual([{ roles: ["Sun.Lead"], count: 2 }]);
    expect(personOf(resolve(relative, ROSTER, "2026-11"), "m-alma").exactRules).toEqual([{ roles: ["Sun.Lead"], count: 3 }]);
  });

  it("turns a count of 0 into out with no item, and trims to the roles that are in", () => {
    const zero = resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ relative: true, relOffset: 9 })] })] });
    expect(personOf(zero, "m-alma")).toMatchObject({ roles: { "Sun.Lead": "out" }, exactRules: [] });
    const trimmed = resolve({ restrictions: [rule("r1", "Carmen", { caps: [cap({ pattern: "*.LeadBGV", value: 1 })] })] });
    expect(personOf(trimmed, "m-carmen").exactRules).toEqual([{ roles: ["Sun.BGV", "Sat.BGV"], count: 1 }]);
  });

  it("ignores <= and >= caps", () => {
    const r = resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ op: "<=" }), cap({ id: "c2", op: ">=" })] })] });
    expect(personOf(r, "m-alma").exactRules).toEqual([]);
  });

  it.each([1.5, -1, 32])("refuses an == value of %d as exact_count_range, even with no covered role in", (value) => {
    for (const person of ["Alma", "Carmen"]) {
      const r = resolve({ restrictions: [rule("r1", person, { caps: [cap({ value })] })] });
      expect(r).toEqual({ ok: false, issues: [], refusals: [{ person, reason: "exact_count_range" }] });
    }
  });

  it("refuses a fractional relOffset that is not clamped — even with no covered role in — accepts one that is, and accepts 0 and 31", () => {
    for (const person of ["Alma", "Carmen"]) {
      expect(resolve({ restrictions: [rule("r1", person, { caps: [cap({ relative: true, relOffset: 0.5 })] })] })).toEqual({
        ok: false,
        issues: [],
        refusals: [{ person, reason: "exact_count_range" }],
      });
    }
    expect(resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ relative: true, relOffset: 4.5 })] })] }).ok).toBe(true);
    expect(resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ value: 0 })] })] }).ok).toBe(true);
    expect(personOf(resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ value: 31 })] })] }), "m-alma").exactRules[0].count).toBe(31);
  });

  it("refuses two == caps of one member that share a role key, across two spellings (A38)", () => {
    const r = resolve({
      restrictions: [rule("r1", "Alma", { caps: [cap({})] }), rule("r2", "Alma Ruiz", { caps: [cap({ id: "c2", pattern: "*.Lead", value: 1 })] })],
    });
    expect(r).toEqual({ ok: false, issues: [], refusals: [{ person: "Alma", reason: "overlapping_exact" }] });
  });

  it("refuses «Mes por medio» with an == rule covering Sun.Lead (A11)", () => {
    const r = resolve({ restrictions: [rule("r1", "Alma", { sundayCadence: "alternate", caps: [cap({})] })] });
    expect(r).toEqual({ ok: false, issues: [], refusals: [{ person: "Alma", reason: "cadence_and_exact" }] });
  });
});

describe("dates (RES-4)", () => {
  it("blocks week exclusions on the week's weekend dates, by day class — the trailing Saturday is week weeks + 1", () => {
    // October 2026: Sundays 4, 11, 18, 25 (weeks = 4); week 2 = Sat 10 + Sun 11; week 5 = Sat 31.
    const r = resolve({
      restrictions: [
        rule("r1", "Alma", {
          weekExclusions: [
            { id: "w1", week: 2, pattern: "*.Lead" },
            { id: "w2", week: 5, pattern: "*.*" },
          ],
        }),
      ],
    });
    expect(personOf(r, "m-alma").blocks).toEqual([
      { date: "2026-10-10", unavailable: false, excludedRoles: ["Sat.Lead"] },
      { date: "2026-10-11", unavailable: false, excludedRoles: ["Sun.Lead"] },
      { date: "2026-10-31", unavailable: false, excludedRoles: ["Sat.Lead", "Sat.BGV", "Sat.Choir"] },
    ]);
  });

  it("marks the member's unavailable dates inside the month and merges them with exclusions", () => {
    const busy = { ...ALMA, unavailableDates: ["2026-10-11", "2026-10-11T00:00:00", "2026-11-01", "nope"] };
    const r = resolve({ restrictions: [rule("r1", "Alma", { weekExclusions: [{ id: "w1", week: 2, pattern: "Sun.BGV" }] })] }, [busy, BRUNO, CARMEN, DIEGO]);
    expect(personOf(r, "m-alma").blocks).toEqual([{ date: "2026-10-11", unavailable: true, excludedRoles: ["Sun.BGV"] }]);
  });
});

describe("names (RES-5, RES-7)", () => {
  it("refuses an unresolved and an ambiguous name, each named", () => {
    const twin: EligibilityMember = { _id: "m-alma2", member_name: "Alma", memberType: ["voz"] };
    const r = resolve({ restrictions: [rule("r1", "Nadie"), rule("r2", "Alma")] }, [...ROSTER, twin]);
    expect(r).toEqual({
      ok: false,
      issues: [],
      refusals: [
        { person: "Nadie", reason: "unresolved" },
        { person: "Alma", reason: "ambiguous" },
      ],
    });
  });

  it("counts a namesake without voz as ambiguous too", () => {
    const twin: EligibilityMember = { _id: "m-alma2", member_name: "Alma", memberType: [] };
    expect(resolve({ restrictions: [rule("r1", "Alma")] }, [...ROSTER, twin])).toMatchObject({ refusals: [{ person: "Alma", reason: "ambiguous" }] });
  });

  it("refuses a rule naming a member with no Tipo — the cadence setting included", () => {
    const empty: EligibilityMember = { _id: "m-elena", member_name: "Elena", memberType: [] };
    expect(resolve({ restrictions: [rule("r1", "Elena", { sundayCadence: "alternate" })] }, [...ROSTER, empty])).toEqual({
      ok: false,
      issues: [],
      refusals: [{ person: "Elena", reason: "no_tipo" }],
    });
  });

  it("puts sundayCadence on the people item of each cadence member", () => {
    const r = resolve({ restrictions: [rule("r1", "Diego", { sundayCadence: "alternate" })] });
    expect(personOf(r, "m-diego").sundayCadence).toBe("alternate");
    expect(personOf(r, "m-alma")).not.toHaveProperty("sundayCadence");
  });

  it("drops kids-only members before anything: never a person, a pool, a block or a name match", () => {
    const kidsAna: EligibilityMember = { _id: "m-kids", member_name: "Ana", alias: "Alma", memberType: ["voz", "sunday_lead"], ministries: ["kids"] };
    const r = resolve({ sundayLeads: ["m-alma", "m-diego", "m-kids"], restrictions: [rule("r1", "Alma", { excludedPatterns: ["Sat.*"] })] }, [...ROSTER, kidsAna]);
    expect(bodyOf(r).people.map((p) => p.memberId)).not.toContain("m-kids");
    expect(personOf(r, "m-alma").roles["Sat.Lead"]).toBe("out");
  });

  it("gives the same body for a worship admin's roster and a super-admin's (viewer independence)", () => {
    const kidsTwin: EligibilityMember = { _id: "m-kids", member_name: "Kim", alias: "Diego", memberType: ["voz", "sunday_lead"], ministries: ["kids"] };
    const cfg = { sundayLeads: ["m-alma", "m-diego", "m-kids"], restrictions: [rule("r1", "Diego", { sundayCadence: "alternate" as const })] };
    expect(resolve(cfg, [...ROSTER, kidsTwin])).toEqual(resolve(cfg, ROSTER));
  });
});

describe("presence (RES-6)", () => {
  const presence = (id: string, persons: string[], pattern = "Sun.BGV") => ({ id, persons, pattern });

  it("records members by id, the six-key roles, and exclusivity from the conflicts", () => {
    const r = resolve({
      presence: [presence("p-1", ["Carmen", "Alma"], "*.BGV")],
      conflicts: [{ id: "x1", personA: "Alma", personB: "Carmen", pattern: "*.LeadBGV" }],
    });
    expect(bodyOf(r).presence).toEqual([{ ruleKey: "p-1", roles: ["Sun.BGV", "Sat.BGV"], members: ["m-alma", "m-carmen"], exclusive: true }]);
    const partial = resolve({
      presence: [presence("p-1", ["Carmen", "Alma"], "*.BGV")],
      conflicts: [{ id: "x1", personA: "Alma", personB: "Carmen", pattern: "Sun.BGV" }],
    });
    expect(bodyOf(partial).presence[0].exclusive).toBe(false);
  });

  it("refuses a person whose Tipo has no voz as presence_member_not_listed", () => {
    const noVoz: EligibilityMember = { _id: "m-fausto", member_name: "Fausto", memberType: ["support"] };
    expect(resolve({ presence: [presence("p-1", ["Alma", "Fausto"])] }, [...ROSTER, noVoz])).toMatchObject({
      ok: false,
      refusals: [{ person: "Fausto", reason: "presence_member_not_listed" }],
    });
  });

  it.each([
    ["one member", [presence("p-1", ["Alma", "Alma Ruiz"])], [{ code: "presence_members", ruleKey: "p-1" }]],
    ["no roles", [presence("p-1", ["Alma", "Bruno"], "Nope.X")], [{ code: "presence_roles", ruleKey: "p-1" }]],
    ["an id outside the grammar", [presence("d alma", ["Alma", "Bruno"])], [{ code: "presence_rule_id", ruleKey: "d alma" }]],
    ["two rules sharing an id", [presence("p-1", ["Alma", "Bruno"]), presence("p-1", ["Carmen", "Diego"])], [{ code: "presence_rule_id", ruleKey: "p-1" }]],
    ["more than 20 rules", Array.from({ length: 21 }, (_, i) => presence(`p-${i}`, ["Alma", "Bruno"])), [{ code: "too_many_presence" }]],
  ])("issues %s", (_label, rules, issues) => {
    expect(resolve({ presence: rules })).toEqual({ ok: false, issues, refusals: [] });
  });

  it("issues more than 12 members", () => {
    const many: EligibilityMember[] = Array.from({ length: 13 }, (_, i) => ({ _id: `m-p${i}`, member_name: `P${i}`, memberType: ["voz", "support"] }));
    expect(resolve({ presence: [presence("p-1", many.map((m) => m.member_name))] }, [...ROSTER, ...many])).toMatchObject({
      ok: false,
      issues: [{ code: "presence_members", ruleKey: "p-1" }],
    });
  });
});

describe("people limits (RES-8)", () => {
  it("issues no_people when no worship member has voz", () => {
    expect(resolveMonthEligibility({ month: "2026-10", config: config(), members: [{ _id: "m-x", member_name: "X", memberType: [] }] })).toEqual({
      ok: false,
      issues: [{ code: "no_people" }],
      refusals: [],
    });
  });

  it("issues too_many_people over 100", () => {
    const members = Array.from({ length: 101 }, (_, i) => ({ _id: `m-${i}`, member_name: `P${i}`, memberType: ["voz", "support"] }));
    expect(resolveMonthEligibility({ month: "2026-10", config: config(), members })).toEqual({
      ok: false,
      issues: [{ code: "too_many_people" }],
      refusals: [],
    });
  });
});

// ─── RES-8: generated inputs ─────────────────────────────────────────────────

/** A small deterministic PRNG (mulberry32), so a failure reproduces from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["Alma", "Bruno", "Carmen", "Diego", "Elena", "Fausto", "Greta", "Iván", "Julia"];
const TIPOS = [[], ["voz"], ["voz", "sunday_lead"], ["voz", "saturday_lead"], ["voz", "support"], ["sunday_lead"], ["voz", "sunday_lead", "support"]];
const MINISTRIES: unknown[] = [undefined, [], ["worship"], ["kids"], ["worship", "kids"]];
const PATTERNS = ["Sun.*", "Sat.*", "*.*", "Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "*.Lead", "*.BGV", "*.LeadBGV", "Lead.*", "Choir.*", "bad"];
const VALUES = [0, 1, 2, 3, 31, 32, 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY];
const OFFSETS = [0, 1, 2, 0.5, 4.5, 9];
const IDS = ["a1b2c3d", "d-alma", "d-alma-bruno", "bad id", "p-1", "p-1", "x".repeat(65)];
const MONTHS = ["2026-08", "2026-09", "2026-10", "2026-11", "2027-02"];

function generate(seed: number): { month: string; config: SolverConfig; members: EligibilityMember[] } {
  const r = rng(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const some = <T,>(list: readonly T[], max: number): T[] => Array.from({ length: Math.floor(r() * (max + 1)) }, () => pick(list));
  const members: EligibilityMember[] = Array.from({ length: 2 + Math.floor(r() * 7) }, (_, i) => {
    const name = pick(NAMES);
    return {
      _id: `m-${i}-${name.normalize("NFD").replace(/[^A-Za-z]/g, "").toLowerCase()}`, // Sanity ids are ASCII
      member_name: `${name} ${i}`,
      ...(r() < 0.6 ? { alias: r() < 0.2 ? pick(NAMES) : name } : {}),
      memberType: [...pick(TIPOS)],
      ...(r() < 0.8 ? { ministries: pick(MINISTRIES) } : {}),
      unavailableDates: some(["2026-10-04", "2026-10-11", "2026-11-01", "2026-09-06", "x"], 2),
    };
  });
  const person = () => (r() < 0.85 ? pick(members).alias ?? pick(members).member_name : pick(["Nadie", ...NAMES]));
  const ids = members.map((m) => m._id);
  return {
    month: pick(MONTHS),
    members,
    config: {
      sundayLeads: some(ids, 3),
      saturdayLeads: some(ids, 3),
      support: some(ids, 4),
      restrictions: Array.from({ length: Math.floor(r() * 4) }, (_, i) => ({
        id: `r${i}`,
        person: person(),
        excludedPatterns: some(PATTERNS, 2),
        fairness: pick(["none", "exempt", "slack"] as const),
        fairnessSlack: 1,
        weekExclusions: some([1, 2, 3, 4, 5, 6], 2).map((week, k) => ({ id: `w${k}`, week, pattern: pick(PATTERNS) })),
        caps: some(["==", "<=", ">="] as const, 2).map((op, k) => ({
          id: `c${k}`,
          pattern: pick(PATTERNS),
          op,
          value: pick(VALUES),
          relative: r() < 0.3,
          relOffset: pick(OFFSETS),
        })),
        ...(r() < 0.2 ? { sundayCadence: "alternate" as const } : {}),
      })),
      conflicts: Array.from({ length: Math.floor(r() * 3) }, (_, i) => ({ id: `x${i}`, personA: person(), personB: person(), pattern: pick(PATTERNS) })),
      presence: Array.from({ length: Math.floor(r() * 3) }, () => ({
        id: pick(IDS),
        persons: Array.from({ length: Math.floor(r() * 4) }, person),
        pattern: pick(PATTERNS),
      })),
    },
  };
}

describe("RES-8: an ok body always passes the validator, and holds no kids-only member", () => {
  it("over 1500 generated configs and rosters", () => {
    let accepted = 0;
    for (let seed = 1; seed <= 1500; seed += 1) {
      const input = generate(seed);
      const result = resolveMonthEligibility(input);
      if (!result.ok) continue;
      accepted += 1;
      const entry = { ...result.body, source: "auto", expectedRev: null };
      for (const currentMonth of [input.month, shiftMonth(input.month, -12)]) {
        const checked = validateFairnessMonthWrite(entry, "route", currentMonth);
        expect(checked.ok ? [] : checked.issues, `seed ${seed}`).toEqual([]);
      }
      const notWorship = new Set(input.members.filter((m) => !normalizeMinistries(m.ministries).includes("worship")).map((m) => m._id));
      const named = [...result.body.people.map((p) => p.memberId), ...result.body.presence.flatMap((p) => p.members)];
      expect(named.filter((id) => notWorship.has(id)), `seed ${seed}`).toEqual([]);
    }
    expect(accepted).toBeGreaterThan(100);
  });
});
