// Solver v3 C4 R4–R9 and R13's refusal mapping, over C2's REAL resolver (IF2-15) and
// record-free seat step (IF2-11) and C2's validator (IF2-18). Every name is fictitious.
import { describe, expect, it } from "vitest";

import type { PersonRestriction, RestrictionCap, SolverConfig } from "@/app/components/admin/plannerModel";
import { resolveMonthEligibility } from "@/app/utils/fairnessEligibility";
import type { LedgerService } from "@/app/utils/fairnessLedger";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import { validateReconstructionBody } from "../lib/reconstructDecide";
import {
  hypotheticalConfig,
  resolverRefusals,
  seatJoinMonths,
  toLedgerServices,
  transformMonth,
  validatorRefusal,
} from "../lib/reconstructInference";
import { parseOverrides, type MemberOverride } from "../lib/reconstructOverrides";
import type { RosterRow } from "../lib/reconstructTypes";

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const ANA: RosterRow = { _id: "m-ana", member_name: "Ana Ejemplo", memberType: ["voz", "sunday_lead"] };
const BETO: RosterRow = { _id: "m-beto", member_name: "Beto Ejemplo", memberType: ["voz", "sunday_lead"], ministries: ["worship"] };
const CARLA: RosterRow = { _id: "m-carla", member_name: "Carla Ejemplo", memberType: ["voz", "support"], ministries: [] };
const DANI: RosterRow = { _id: "kidsMember-dani", member_name: "Dani Ejemplo", memberType: ["voz", "sunday_lead"], ministries: ["kids", "worship"] };
const FAUSTO: RosterRow = { _id: "m-fausto", member_name: "Fausto Ejemplo", memberType: ["sunday_lead"], unavailableDates: ["2026-09-20", "2026-08-30"] };
const IVAN: RosterRow = { _id: "m-ivan", member_name: "Iván Ejemplo", memberType: ["voz", "saturday_lead"] };
const ROSTER = [ANA, BETO, CARLA, DANI, FAUSTO, IVAN];

const restriction = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id,
  person,
  excludedPatterns: [],
  fairness: "none",
  fairnessSlack: 1,
  weekExclusions: [],
  caps: [],
  ...patch,
});
const cap = (id: string, pattern: string, value: number, patch: Partial<RestrictionCap> = {}): RestrictionCap => ({
  id,
  pattern,
  op: "==",
  value,
  relative: false,
  relOffset: 0,
  ...patch,
});
const config = (patch: Partial<SolverConfig> = {}): SolverConfig => ({
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [],
  presence: [],
  ...patch,
});
const svc = (
  id: string,
  type: LedgerService["_type"],
  date: string,
  seats: Partial<Pick<LedgerService, "Lead" | "BGVs" | "Chorus">>,
  extra: Partial<LedgerService> = {},
): LedgerService => ({ _id: id, _type: type, date, Lead: [], BGVs: [], Chorus: [], ...seats, ...extra });

const resolved = (month: string, cfg: SolverConfig, roster: RosterRow[] = ROSTER): FairnessMonthBody => {
  const r = resolveMonthEligibility({ month, config: hypotheticalConfig(cfg, roster), members: roster });
  if (!r.ok) throw new Error(`resolver refused: ${JSON.stringify(r)}`);
  return r.body;
};
const corrections = (doc: unknown, roster: RosterRow[] = ROSTER): MemberOverride[] => {
  const parsed = parseOverrides(JSON.stringify(doc), new Set(roster.map((m) => m._id)));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.refusals));
  return parsed.overrides.members;
};
const transform = (month: string, cfg: SolverConfig, services: LedgerService[], o: MemberOverride[] = [], roster: RosterRow[] = ROSTER) =>
  transformMonth({ month, body: resolved(month, cfg, roster), roster, seatJoins: seatJoinMonths(services), overrides: o });
const person = (b: FairnessMonthBody, id: string) => {
  const found = b.people.find((p) => p.memberId === id);
  if (!found) throw new Error(`no item for ${id}`);
  return found;
};
const valid = (b: FairnessMonthBody) => validateReconstructionBody({ ...b, expectedRev: null }, "2026-10");

describe("R4 — Tipo today as hypothetical pool ticks; today's rules unaltered", () => {
  it("ticks every worship member whose current Tipo fits each pool, and passes every rule array through", () => {
    const cfg = config({ sundayLeads: ["m-carla"], restrictions: [restriction("d-ana", "Ana Ejemplo", { excludedPatterns: ["Sat.*"] })] });
    const hypothetical = hypotheticalConfig(cfg, ROSTER);
    expect(hypothetical.sundayLeads).toEqual(["kidsMember-dani", "m-ana", "m-beto"]);
    expect(hypothetical.saturdayLeads).toEqual(["m-ivan"]);
    expect(hypothetical.support).toEqual(["m-carla"]);
    expect(hypothetical.restrictions).toBe(cfg.restrictions);
    expect(hypothetical.conflicts).toBe(cfg.conflicts);
    expect(hypothetical.presence).toBe(cfg.presence);
  });

  it("gives exactly C2's resolver statuses for those ticks, before R5–R8 — and nobody without voz", () => {
    const b = resolved("2026-08", config({ restrictions: [restriction("d-ana", "Ana Ejemplo", { excludedPatterns: ["Sat.*"] })] }));
    expect(person(b, "m-ana").roles).toEqual({ ...OUT, "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "in" });
    expect(person(b, "m-carla").roles).toEqual({ ...OUT, "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in" });
    expect(b.people.map((p) => p.memberId)).not.toContain("m-fausto");
  });
});

describe("IF2-26 rows → IF2-10 services", () => {
  it("keeps non-empty references in stored order, drops a row with no valid date, refuses a non-list", () => {
    expect(
      toLedgerServices([
        { _id: "sun-1", _type: "sunday_role", date: "2026-08-02", time: null, published: false, countsForFairness: true, Lead: ["m-ana", null, ""], BGVs: null, Chorus: ["m-beto"] },
        { _id: "sun-2", _type: "sunday_role", date: "no es fecha", countsForFairness: true, Lead: [], BGVs: [], Chorus: [] },
      ]),
    ).toEqual([{ _id: "sun-1", _type: "sunday_role", date: "2026-08-02", published: false, countsForFairness: true, Lead: ["m-ana"], BGVs: [], Chorus: ["m-beto"] }]);
    expect(() => toLedgerServices({ rows: [] })).toThrow(/read failed: services/);
  });
});

describe("R5 — seats may only delay a line's start", () => {
  const seats = [
    svc("sun-0906", "sunday_role", "2026-09-06", { Lead: ["m-ana"] }),
    svc("sun-0913", "sunday_role", "2026-09-13", { BGVs: ["m-carla"] }),
  ];

  it("keeps a newcomer out of BGV before her first BGV seat, and in from that month", () => {
    const august = transform("2026-08", config(), seats);
    const september = transform("2026-09", config(), seats);
    expect(person(august.body, "m-carla").roles["Sun.BGV"]).toBe("out");
    expect(august.cells.get("m-carla")!["Sun.BGV"]).toEqual({ reason: "linea", corrected: false });
    expect(person(september.body, "m-carla").roles).toMatchObject({ "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "out" });
    expect(september.joins.get("m-carla")).toEqual({ BGV: "2026-09" });
  });

  it("never makes anyone eligible: a seat held while a rule says out stays out", () => {
    const cfg = config({ restrictions: [restriction("d-ana", "Ana Ejemplo", { excludedPatterns: ["Sat.*"] })] });
    const t = transform("2026-08", cfg, [svc("sat-0801", "saturday_role", "2026-08-01", { BGVs: ["m-ana"] })]);
    expect(person(t.body, "m-ana").roles["Sat.BGV"]).toBe("out");
  });

  it("sets no join month from a second seat, a duplicated weekend document or an uncounted special", () => {
    const joins = seatJoinMonths([
      svc("sun-0802", "sunday_role", "2026-08-02", { Lead: ["m-carla"], BGVs: ["m-carla"] }),
      svc("sun-0816-a", "sunday_role", "2026-08-16", { BGVs: ["m-ana"] }),
      svc("sun-0816-b", "sunday_role", "2026-08-16", {}),
      svc("spe-0830", "special_role", "2026-08-30", { Chorus: ["m-ana"] }),
      svc("spe-0809", "special_role", "2026-08-09", { Chorus: ["m-carla"] }, { countsForFairness: true }),
    ]);
    expect(joins.get("m-carla")).toEqual({
      DL: { month: "2026-08", firstSeatDate: "2026-08-02" },
      CORO: { month: "2026-08", firstSeatDate: "2026-08-09" },
    });
    expect(joins.get("m-ana")).toBeUndefined();
  });

  it("keeps exact rules whole: a cut rule is removed and its joined role becomes in, with the anomaly", () => {
    const cfg = config({ restrictions: [restriction("r1", "Ana Ejemplo", { caps: [cap("c1", "Sun.*", 2)] })] });
    const t = transform("2026-08", cfg, [
      svc("sun-0705", "sunday_role", "2026-07-05", { Lead: ["m-ana"] }),
      svc("sun-0712", "sunday_role", "2026-07-12", { BGVs: ["m-ana"] }),
    ]);
    const ana = person(t.body, "m-ana");
    expect(ana.exactRules).toEqual([]);
    expect(ana.roles).toMatchObject({ "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "out" });
    expect(t.cells.get("m-ana")!["Sun.Lead"]).toEqual({ reason: "partida", corrected: false });
    expect(t.anomalies).toEqual([{ code: "rule_split", month: "2026-08", memberId: "m-ana", roles: ["Sun.Lead", "Sun.BGV"] }]);
    expect(valid(t.body)).toEqual({ ok: true });
  });
});

describe("R6 — the cadence setting applied, never inferred", () => {
  const cadence = restriction("c9p4", "Dani Ejemplo", { sundayCadence: "alternate" });

  it("records in + alternate for Sun.Lead in every month without a DL seat, and bounds her other lines", () => {
    const seats = [svc("sun-0719", "sunday_role", "2026-07-19", { Lead: ["kidsMember-dani"] })];
    for (const month of ["2026-06", "2026-07", "2026-08"]) {
      const dani = person(transform(month, config({ restrictions: [cadence] }), seats).body, "kidsMember-dani");
      expect(dani.roles["Sun.Lead"]).toBe("in");
      expect(dani.sundayCadence).toBe("alternate");
      expect(dani.roles["Sun.BGV"]).toBe("out");
    }
  });

  it("keeps the setting on someone whose Sun.Lead is out, as the resolver returns it", () => {
    const t = transform("2026-08", config({ restrictions: [restriction("c9p4", "Dani Ejemplo", { sundayCadence: "alternate", excludedPatterns: ["Sun.Lead"] })] }), []);
    expect(person(t.body, "kidsMember-dani")).toMatchObject({ sundayCadence: "alternate", roles: OUT });
  });

  it("case (a): the setting beside Sun.Lead == 2 in today's rules refuses through the resolver, named by ordinals", () => {
    const cfg = config({ restrictions: [restriction("c9p4", "Dani Ejemplo", { sundayCadence: "alternate", caps: [cap("c9c", "Sun.Lead", 2)] })] });
    const r = resolveMonthEligibility({ month: "2026-08", config: hypotheticalConfig(cfg, ROSTER), members: ROSTER });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(resolverRefusals(r, cfg, ROSTER, "2026-08")).toContainEqual(
      expect.objectContaining({
        reason: "cadence_and_exact",
        kind: "mes por medio",
        person: "Dani Ejemplo",
        memberIds: ["kidsMember-dani"],
        rules: [
          { ordinal: "restricción 1 de 1", key: "c9p4" },
          { ordinal: "restricción 1 de 1, tope 1", key: "c9c" },
        ],
      }),
    );
  });

  it("case (b): «alternate» from the corrections file beside a rules-side Sun.Lead == 2 fails the validator", () => {
    const cfg = config({ restrictions: [restriction("x1", "Ana Ejemplo", { caps: [cap("x1c", "Sun.Lead", 2)] })] });
    const file = corrections({ schemaVersion: 1, members: { "m-ana": { sundayCadence: "alternate" } } });
    const t = transform("2026-08", cfg, [], file);
    const checked = valid(t.body);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(validatorRefusal("2026-08", t.body, checked.issues, file)).toMatchObject({
      reason: "invalid_body",
      kind: "corrección",
      rules: [{ ordinal: "entrada 1 del archivo", key: null }],
      memberIds: ["m-ana"],
    });
  });

  it("case (c): «alternate» plus Sun.Lead in replaces a v2-only Sun.Lead == 2, marked corregido, and passes", () => {
    const cfg = config({ restrictions: [restriction("x1", "Ana Ejemplo", { caps: [cap("x1c", "Sun.Lead", 2)] })] });
    const file = corrections({ schemaVersion: 1, members: { "m-ana": { sundayCadence: "alternate", months: { "*": { roles: { "Sun.Lead": "in" } } } } } });
    const t = transform("2026-08", cfg, [], file);
    const ana = person(t.body, "m-ana");
    expect(ana).toMatchObject({ sundayCadence: "alternate", exactRules: [] });
    expect(ana.roles["Sun.Lead"]).toBe("in");
    expect(t.cells.get("m-ana")!["Sun.Lead"]).toEqual({ reason: "correccion", corrected: true });
    expect(valid(t.body)).toEqual({ ok: true });
  });

  it("«normal» removes the setting, and the DL line is then join-bounded", () => {
    const file = corrections({ schemaVersion: 1, members: { "kidsMember-dani": { sundayCadence: "normal" } } });
    const dani = person(transform("2026-08", config({ restrictions: [cadence] }), [], file).body, "kidsMember-dani");
    expect(dani.sundayCadence).toBeUndefined();
    expect(dani.roles["Sun.Lead"]).toBe("out");
  });
});

describe("R8 — corrections win, and replace exact rules whole (A38)", () => {
  const seated = [svc("sun-0705", "sunday_role", "2026-07-05", { BGVs: ["m-beto"] })];

  it("replaces today's Sun.BGV == 1 with Sun.BGV == 2: exactly one exact rule for Sun.BGV", () => {
    const cfg = config({ restrictions: [restriction("r7k2", "Beto Ejemplo", { caps: [cap("c1q9", "Sun.BGV", 1)] })] });
    const file = corrections({ schemaVersion: 1, members: { "m-beto": { months: { "2026-08": { exactRules: [{ roles: ["Sun.BGV"], count: 2 }] } } } } });
    const t = transform("2026-08", cfg, seated, file);
    expect(person(t.body, "m-beto").exactRules).toEqual([{ roles: ["Sun.BGV"], count: 2 }]);
    expect(t.corrections).toEqual([{ memberId: "m-beto", field: "Sun.BGV" }]);
    expect(valid(t.body)).toEqual({ ok: true });
  });

  it("refuses a correction on one role of a two-role rule that does not restate the other", () => {
    const cfg = config({ restrictions: [restriction("r7k2", "Beto Ejemplo", { caps: [cap("c1q9", "*.BGV", 2)] })] });
    const file = corrections({ schemaVersion: 1, members: { "m-beto": { months: { "2026-08": { roles: { "Sun.BGV": "out" } } } } } });
    expect(transform("2026-08", cfg, seated, file).refusals).toEqual([
      expect.objectContaining({
        reason: "replacement_incomplete",
        kind: "corrección",
        rules: [{ ordinal: "entrada 1 del archivo", key: null }],
        month: "2026-08",
        memberIds: ["m-beto"],
      }),
    ]);
  });

  it("adds a worship member without voz when a correction sets one of her roles, with her month's stored dates", () => {
    const file = corrections({ schemaVersion: 1, members: { "m-fausto": { months: { "2026-09": { roles: { "Sun.BGV": "in" } } } } } });
    const t = transform("2026-09", config(), [], file);
    expect(person(t.body, "m-fausto")).toEqual({
      memberId: "m-fausto",
      roles: { ...OUT, "Sun.BGV": "in" },
      exactRules: [],
      exempt: false,
      blocks: [{ date: "2026-09-20", unavailable: true, excludedRoles: [] }],
    });
    expect(t.anomalies).toContainEqual({ code: "person_added", month: "2026-09", memberId: "m-fausto" });
    expect(t.corrections).toEqual([
      { memberId: "m-fausto", field: "Sun.BGV" },
      { memberId: "m-fausto", field: "added" },
    ]);
    expect(valid(t.body)).toEqual({ ok: true });
  });

  it("adds nobody for a correction that sets no role, and lets a correction win over a join bound", () => {
    const file = corrections({ schemaVersion: 1, members: { "m-fausto": { exempt: true }, "m-carla": { joinMonths: { BGV: "2026-07" } } } });
    const t = transform("2026-08", config(), [svc("sun-0913", "sunday_role", "2026-09-13", { BGVs: ["m-carla"] })], file);
    expect(t.body.people.map((p) => p.memberId)).not.toContain("m-fausto");
    expect(person(t.body, "m-carla").roles["Sun.BGV"]).toBe("in");
    expect(t.joins.get("m-carla")).toEqual({ BGV: "2026-07" });
  });

  it("merges a blocked-date correction into an existing week-exclusion block", () => {
    const cfg = config({ restrictions: [restriction("w3x8", "Iván Ejemplo", { weekExclusions: [{ id: "e5m1", week: 2, pattern: "Sat.*" }] })] });
    const file = corrections({ schemaVersion: 1, members: { "m-ivan": { blockedDates: [{ date: "2026-08-08", roles: ["Sun.BGV"] }, { date: "2026-08-15" }] } } });
    const t = transform("2026-08", cfg, [svc("sat-0711", "saturday_role", "2026-07-11", { Lead: ["m-ivan"] })], file);
    expect(person(t.body, "m-ivan").blocks).toEqual([
      { date: "2026-08-08", unavailable: false, excludedRoles: ["Sat.Lead", "Sun.BGV", "Sat.BGV", "Sat.Choir"] },
      { date: "2026-08-15", unavailable: true, excludedRoles: [] },
    ]);
    expect(t.corrections).toContainEqual({ memberId: "m-ivan", field: "blocks" });
    expect(valid(t.body)).toEqual({ ok: true });
  });
});

describe("R9 — availability is the month's stored dates", () => {
  it("never lets a date outside the month into it", () => {
    const beto: RosterRow = { ...BETO, unavailableDates: ["2026-07-26", "2025-12-25", "2026-08-02"] };
    const t = transform("2026-07", config(), [svc("sun-0705", "sunday_role", "2026-07-05", { Lead: ["m-beto"] })], [], [ANA, beto, CARLA, DANI, FAUSTO, IVAN]);
    expect(person(t.body, "m-beto").blocks).toEqual([{ date: "2026-07-26", unavailable: true, excludedRoles: [] }]);
  });
});

describe("R13 — resolver refusals, by ordinal", () => {
  const refusalsOf = (cfg: SolverConfig, roster: RosterRow[] = ROSTER) => {
    const r = resolveMonthEligibility({ month: "2026-08", config: hypotheticalConfig(cfg, roster), members: roster });
    if (r.ok) throw new Error("expected a refusal");
    return resolverRefusals(r, cfg, roster, "2026-08");
  };

  it("names a presence issue by its config ordinal; the key stays for the report", () => {
    expect(refusalsOf(config({ presence: [{ id: "d-beto-carla", persons: ["Carla Ejemplo"], pattern: "Sun.BGV" }] }))).toContainEqual(
      expect.objectContaining({ reason: "presence_members", kind: "presencia", rules: [{ ordinal: "presencia 1 de 1", key: "d-beto-carla" }] }),
    );
  });

  it("names an out-of-range == cap by its restriction's ordinal plus its own position", () => {
    const cfg = config({ restrictions: [restriction("d-ana", "Ana Ejemplo", { caps: [cap("q1", "Sun.Lead", 1, { op: "<=" }), cap("q2", "Sun.BGV", 1.5)] })] });
    expect(refusalsOf(cfg)).toContainEqual(
      expect.objectContaining({
        reason: "exact_count_range",
        kind: "regla fija",
        rules: [{ ordinal: "restricción 1 de 1, tope 2", key: "q2" }],
        memberIds: ["m-ana"],
      }),
    );
  });

  it("names every rule that carries an unresolved name", () => {
    const cfg = config({
      restrictions: [restriction("r1", "Nadie Ejemplo")],
      conflicts: [{ id: "k1", personA: "Nadie Ejemplo", personB: "Ana Ejemplo", pattern: "Sun.Lead" }],
    });
    expect(refusalsOf(cfg)).toContainEqual(
      expect.objectContaining({
        reason: "unresolved",
        kind: "restricción",
        person: "Nadie Ejemplo",
        memberIds: [],
        rules: [
          { ordinal: "restricción 1 de 1", key: "r1" },
          { ordinal: "conflicto 1 de 1", key: "k1" },
        ],
      }),
    );
  });
});
