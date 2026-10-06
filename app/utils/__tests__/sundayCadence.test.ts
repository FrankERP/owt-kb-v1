// Solver v3 C3 §6.5, §6.7, §7 items 4–5 — the exactly-one name resolver, the
// cadence members, and the «Mes por medio fuera de Líderes Domingo» predicate
// (T9, T10).
//
// The roster is the UNFILTERED worship roster: no `voz`, pool or Tipo filter
// (any of them can hide a true namesake), but the resolver drops every member
// whose ministries exclude worship ITSELF — the planner's `members` is
// worship-only for a worship admin and everyone for a super-admin (E25), and one
// config must resolve the same for both.
import { describe, expect, it } from "vitest";

import {
  CADENCE_OUTSIDE_HEADING,
  CADENCE_OUTSIDE_SENTENCE,
  CADENCE_V2_NOTE,
  SLACK_V3_NOTE,
  cadenceMembers,
  cadenceOutsideSundayPool,
  resolveRulePersonId,
  type RosterMember,
} from "../sundayCadence";
import { rulePersonNamesMember } from "../memberRuleNames";
import type { PersonRestriction, SolverConfig } from "@/app/components/admin/plannerModel";

const member = (_id: string, member_name: string, extra: Partial<RosterMember> = {}): RosterMember => ({
  _id, member_name, memberType: ["voz", "sunday_lead"], ...extra,
});
const ANA = member("m-ana", "Ana Ruiz", { alias: "Ana" });
const BRUNO = member("m-bruno", "Bruno Díaz", { alias: "Bruno" });
const CARLA = member("m-carla", "Carla Soto");
const WORSHIP = [ANA, BRUNO, CARLA];
const KIDS_ANA = member("m-kids-ana", "Ana Pérez", { alias: "Ana", ministries: ["kids"] });
const KIDS_ONLY = member("m-kids-dora", "Dora León", { ministries: ["kids"] });

const rule = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], ...patch,
});
const cadence = (id: string, person: string) => rule(id, person, { sundayCadence: "alternate" });
const config = (restrictions: PersonRestriction[], sundayLeads: string[] = []): Pick<SolverConfig, "restrictions" | "sundayLeads"> => ({
  restrictions, sundayLeads,
});

describe("resolveRulePersonId — exactly one (C3 T9)", () => {
  it("one match ⇒ its id; by member_name or by alias", () => {
    expect(resolveRulePersonId("Ana", WORSHIP)).toEqual({ ok: true, id: "m-ana" });
    expect(resolveRulePersonId("Carla Soto", WORSHIP)).toEqual({ ok: true, id: "m-carla" });
  });

  it("no match ⇒ `unresolved`, with no matches", () => {
    expect(resolveRulePersonId("Zoe", WORSHIP)).toEqual({ ok: false, reason: "unresolved", matches: [] });
  });

  it("a member_name equal to another's alias ⇒ `ambiguous` with both ids, sorted", () => {
    const roster = [...WORSHIP, member("m-ana2", "Ana")];
    expect(resolveRulePersonId("Ana", roster)).toEqual({ ok: false, reason: "ambiguous", matches: ["m-ana", "m-ana2"] });
  });

  it("two equal aliases ⇒ `ambiguous`", () => {
    const roster = [...WORSHIP, member("m-bruno2", "Bruno Gil", { alias: "Bruno" })];
    expect(resolveRulePersonId("bruno", roster)).toEqual({ ok: false, reason: "ambiguous", matches: ["m-bruno", "m-bruno2"] });
  });

  it("case and trim behave exactly as `rulePersonNamesMember`", () => {
    for (const text of ["ana", "  ANA ", "Ana Ruiz", " ana ruiz", "An a", ""]) {
      const expected = WORSHIP.filter((m) => rulePersonNamesMember(text, m)).map((m) => m._id);
      const got = resolveRulePersonId(text, WORSHIP);
      expect(got.ok ? [got.id] : got.matches, JSON.stringify(text)).toEqual(expected);
    }
  });

  it("applies NO `voz`, pool or Tipo filter: a namesake without Tipo still makes the name ambiguous", () => {
    const roster = [...WORSHIP, member("m-ana3", "Ana Gómez", { alias: "Ana", memberType: [] })];
    expect(resolveRulePersonId("Ana", roster)).toMatchObject({ ok: false, reason: "ambiguous" });
  });
});

describe("the worship filter is applied inside (C3 T9, E25)", () => {
  it("a worship member plus a kids-only namesake ⇒ the worship id, not `ambiguous`", () => {
    expect(resolveRulePersonId("Ana", [...WORSHIP, KIDS_ANA])).toEqual({ ok: true, id: "m-ana" });
  });

  it("a name matching only a kids-only member ⇒ `unresolved`", () => {
    expect(resolveRulePersonId("Dora León", [...WORSHIP, KIDS_ONLY])).toEqual({ ok: false, reason: "unresolved", matches: [] });
  });

  it("`ministries` absent, `[]` and `[\"worship\",\"kids\"]` are all worship", () => {
    for (const ministries of [undefined, [], ["worship", "kids"]]) {
      expect(resolveRulePersonId("Ana", [member("m-ana", "Ana Ruiz", { alias: "Ana", ministries })]))
        .toEqual({ ok: true, id: "m-ana" });
    }
  });

  it("one config gives one answer for a worship admin's roster and a super-admin's", () => {
    const c = config([cadence("r-1", "Ana"), cadence("r-2", "Dora León"), cadence("r-3", "Bruno")]);
    const worshipAdmin = WORSHIP;
    const superAdmin = [...WORSHIP, KIDS_ANA, KIDS_ONLY];
    expect(cadenceMembers(c, superAdmin)).toEqual(cadenceMembers(c, worshipAdmin));
    expect(cadenceOutsideSundayPool(c, superAdmin)).toEqual(cadenceOutsideSundayPool(c, worshipAdmin));
    expect(resolveRulePersonId("Ana", superAdmin)).toEqual(resolveRulePersonId("Ana", worshipAdmin));
  });
});

describe("cadenceMembers (C3 T9)", () => {
  it("is the union over every «Mes por medio» restriction, each id once, sorted", () => {
    const c = config([
      cadence("r-1", "Carla Soto"),
      cadence("r-2", "Ana"),
      cadence("r-3", "ana ruiz"), // another spelling of Ana
      rule("r-4", "Bruno"), // «Normal»: not a cadence member
    ]);
    expect(cadenceMembers(c, WORSHIP)).toEqual({ ids: ["m-ana", "m-carla"], refusals: [] });
  });

  it("names every refused person text once, never guessing", () => {
    const roster = [...WORSHIP, member("m-bruno2", "Bruno Gil", { alias: "Bruno" })];
    const c = config([cadence("r-1", "Zoe"), cadence("r-2", "Bruno"), cadence("r-3", "Zoe"), cadence("r-4", "Ana")]);
    expect(cadenceMembers(c, roster)).toEqual({
      ids: ["m-ana"],
      refusals: [
        { person: "Zoe", reason: "unresolved", matches: [] },
        { person: "Bruno", reason: "ambiguous", matches: ["m-bruno", "m-bruno2"] },
      ],
    });
  });
});

describe("cadenceOutsideSundayPool (C3 T10)", () => {
  const NO_VOZ = member("m-eva", "Eva Luna", { memberType: ["sunday_lead"] });
  const SUPPORT = member("m-fer", "Fernando Gil", { alias: "Fer", memberType: ["voz", "support"] });
  const NO_TIPO = member("m-gina", "Gina Ortiz", { memberType: [] });
  const NO_TIPO_FIELD: RosterMember = { _id: "m-hugo", member_name: "Hugo Vela" };
  const ROSTER = [...WORSHIP, NO_VOZ, SUPPORT, NO_TIPO, NO_TIPO_FIELD];

  it("`not_ticked`: fits the Sunday pool by Tipo but is not in «Líderes Domingo»", () => {
    expect(cadenceOutsideSundayPool(config([cadence("r", "Ana")], ["m-carla"]), ROSTER)).toEqual([
      { id: "m-ana", name: "Ana", reason: "not_ticked" },
    ]);
  });

  it("ticked with a fitting Tipo ⇒ absent", () => {
    expect(cadenceOutsideSundayPool(config([cadence("r", "Ana")], ["m-ana"]), ROSTER)).toEqual([]);
  });

  it("`no_sunday_lead_tipo`: a Tipo without «Líder Domingo», ticked or not", () => {
    for (const ticks of [[], ["m-fer"]]) {
      expect(cadenceOutsideSundayPool(config([cadence("r", "Fer")], ticks), ROSTER)).toEqual([
        { id: "m-fer", name: "Fer", reason: "no_sunday_lead_tipo" },
      ]);
    }
  });

  it("«Líder Domingo» without «Voz», even ticked ⇒ `no_sunday_lead_tipo`", () => {
    expect(cadenceOutsideSundayPool(config([cadence("r", "Eva Luna")], ["m-eva"]), ROSTER)).toEqual([
      { id: "m-eva", name: "Eva Luna", reason: "no_sunday_lead_tipo" },
    ]);
  });

  it("a member with no Tipo — `[]` or absent — is never listed, ticked or not (C2 refuses her build)", () => {
    for (const ticks of [[], ["m-gina", "m-hugo"]]) {
      expect(cadenceOutsideSundayPool(config([cadence("r-1", "Gina Ortiz"), cadence("r-2", "Hugo Vela")], ticks), ROSTER)).toEqual([]);
    }
  });

  it("refused names are not listed (they have their own surfaces)", () => {
    const roster = [...ROSTER, member("m-ana2", "Ana")];
    expect(cadenceOutsideSundayPool(config([cadence("r-1", "Ana"), cadence("r-2", "Zoe")]), roster)).toEqual([]);
  });

  it("a name matching only a kids-only member is absent", () => {
    expect(cadenceOutsideSundayPool(config([cadence("r", "Dora León")]), [...ROSTER, KIDS_ONLY])).toEqual([]);
  });

  it("lists in id order", () => {
    const got = cadenceOutsideSundayPool(config([cadence("r-1", "Fer"), cadence("r-2", "Carla Soto"), cadence("r-3", "Ana")]), ROSTER);
    expect(got.map((x) => x.id)).toEqual(["m-ana", "m-carla", "m-fer"]);
  });
});

describe("the copy C6 gates (C3 §7 item 5)", () => {
  it("has one wording", () => {
    expect(CADENCE_V2_NOTE).toBe("aplica con el nuevo solver");
    expect(SLACK_V3_NOTE).toBe("no aplica con el nuevo solver");
    expect(CADENCE_OUTSIDE_HEADING).toBe("Mes por medio fuera de Líderes Domingo");
    expect(CADENCE_OUTSIDE_SENTENCE.not_ticked("Ana")).toBe(
      "Ana no está en Líderes Domingo: descansa este mes, sin domingo y sin sábado de compensación.",
    );
    expect(CADENCE_OUTSIDE_SENTENCE.no_sunday_lead_tipo("Fer")).toBe(
      "Fer no tiene «Voz» y «Líder Domingo» a la vez en su Tipo: descansa este mes, sin domingo y sin sábado de compensación.",
    );
  });
});
