// ADR-0092 (C1): the two translations of rule people — ids in storage, names everywhere else.
// `rulePeopleToNames` at every read, `rulePeopleToIds` at the one write. Proved here: without the
// marker both are the identity; with it every label resolves to exactly its own member or to nobody,
// labels are unique and stable, the write refuses instead of guessing, and an unchanged view
// round-trips byte-identical through the real client path (JSON → reader → parser).
import { describe, expect, it } from "vitest";

import type { SolverConfig } from "@/app/components/admin/plannerModel";
import { resolveRulePersonId } from "@/app/utils/sundayCadence";
import {
  RULE_PERSON_GONE,
  parseSolverConfigWrite,
  rulePeopleOf,
  rulePeopleToIds,
  rulePeopleToNames,
  solverConfigFields,
  solverConfigFromDocument,
  type RulePeopleRosterMember,
} from "@/app/utils/solverConfigWriteRequest";

// Realistic Sanity ids: 22-character and 36-character (UUID) shapes.
const VALE = "x8Kq2mZpL0aB9cD3eF4gH5";
const MKZ = "3f1c9a52-7b6e-4d0a-9c2e-5a8b7d6e4f31";
const GABY = "Qw7Er8Ty9Ui0Op1As2Df3G";
const KIDS_ANA = "kidsMember-ana";
const JOV_LUIS = "Jv1Lu2Is3Xy4Zz5Ww6Vv7U";
const GONE = "Zz9Yy8Xx7Ww6Vv5Uu4Tt3S";

const ROSTER: RulePeopleRosterMember[] = [
  { _id: VALE, member_name: "Valeria Sosa", alias: "Vale 𑣲", ministries: ["worship"] },
  { _id: MKZ, member_name: "Marco Kuri", alias: "Mkz" }, // no `ministries`: worship
  { _id: GABY, member_name: "Gabriela Soto", alias: "Gaby", ministries: ["worship", "jovenes"] },
  { _id: KIDS_ANA, member_name: "Ana", ministries: ["kids"] },
  { _id: JOV_LUIS, member_name: "Luis Pérez", alias: "Luis", ministries: ["jovenes"] },
];

function config(people: { r?: string[]; c?: Array<[string, string]>; p?: string[][] }): SolverConfig {
  return {
    sundayLeads: [MKZ],
    saturdayLeads: [],
    support: [GABY],
    restrictions: (people.r ?? []).map((person, i) => ({
      id: `r${i}`,
      person,
      excludedPatterns: ["Sat.*"],
      fairness: "none",
      fairnessSlack: 1,
      weekExclusions: [],
      caps: [],
    })),
    conflicts: (people.c ?? []).map(([a, b], i) => ({ id: `c${i}`, personA: a, personB: b, pattern: "*.LeadBGV" })),
    presence: (people.p ?? []).map((persons, i) => ({ id: `p${i}`, persons, pattern: "Sun.BGV" })),
  };
}

function doc(c: SolverConfig, ids: boolean, rev = "rev-1"): Record<string, unknown> {
  return { _id: "solverConfig", _type: "solverConfig", _rev: rev, ...solverConfigFields(c), ...(ids ? { personTokens: "id" } : {}) };
}

/** What a browser holds after the GET: the body through JSON and the client's reader. */
const viaClient = (c: SolverConfig) => solverConfigFromDocument(JSON.parse(JSON.stringify(c)));

const asRows = (roster: RulePeopleRosterMember[]) =>
  roster.map((m) => ({ _id: m._id, member_name: String(m.member_name ?? ""), alias: m.alias as string | undefined, ministries: m.ministries }));

describe("rulePeopleToNames", () => {
  it("is the identity without the marker", () => {
    const d = doc(config({ r: ["Vale 𑣲", "nadie"], c: [["Mkz", "Gaby"]] }), false);
    const out = rulePeopleToNames(d, ROSTER);
    expect(out.config).toEqual(solverConfigFromDocument(d));
    expect(out.back.size).toBe(0);
  });

  it("reads each id as the text that resolves to that member", () => {
    const out = rulePeopleToNames(doc(config({ r: [VALE], c: [[MKZ, GABY]], p: [[VALE, GABY]] }), true), ROSTER);
    expect(rulePeopleOf(out.config)).toEqual(["Vale 𑣲", "Mkz", "Gaby", "Vale 𑣲", "Gaby"]);
    for (const label of rulePeopleOf(out.config)) expect(resolveRulePersonId(label, asRows(ROSTER)).ok).toBe(true);
    // The pools are untouched: they already were ids.
    expect(out.config.sundayLeads).toEqual([MKZ]);
  });

  it("reads a short Kids-style id that is no member any more as «persona que ya no está en Alabanza»", () => {
    const roster = ROSTER.filter((m) => m._id !== KIDS_ANA);
    const out = rulePeopleToNames(doc(config({ r: [KIDS_ANA] }), true), roster);
    expect(out.config.restrictions[0].person).toBe(RULE_PERSON_GONE);
  });

  it("falls back to member_name when the display name is someone else's too", () => {
    const roster = [...ROSTER, { _id: "Other00000000000000001", member_name: "Mkz", ministries: ["worship"] }];
    const out = rulePeopleToNames(doc(config({ r: [MKZ] }), true), roster);
    expect(out.config.restrictions[0].person).toBe("Marco Kuri");
  });

  it("labels a person sharing both texts with another as «(persona repetida)», which resolves to nobody", () => {
    const twin = { _id: "Twin00000000000000001", member_name: "Marco Kuri", alias: "Mkz", ministries: ["worship"] };
    const out = rulePeopleToNames(doc(config({ r: [MKZ] }), true), [...ROSTER, twin]);
    const label = out.config.restrictions[0].person;
    expect(label).toBe("Mkz (persona repetida)");
    expect(resolveRulePersonId(label, asRows([...ROSTER, twin])).ok).toBe(false);
  });

  it("labels a member outside Alabanza «(fuera de Alabanza)» even when a worship member has their name", () => {
    const worshipAna = { _id: "AnaW0000000000000000001", member_name: "Ana", ministries: ["worship"] };
    const roster = [...ROSTER, worshipAna];
    const out = rulePeopleToNames(doc(config({ r: [KIDS_ANA] }), true), roster);
    const label = out.config.restrictions[0].person;
    expect(label).toBe("Ana (fuera de Alabanza)");
    expect(resolveRulePersonId(label, asRows(roster)).ok).toBe(false);
  });

  it("gives several gone people distinct labels, numbered by stored token and stable under reordering", () => {
    const ids = ["Gone0000000000000000003", "Gone0000000000000000001", "Gone0000000000000000002"];
    const a = rulePeopleToNames(doc(config({ r: ids }), true), ROSTER).config;
    expect(a.restrictions.map((r) => r.person)).toEqual([`${RULE_PERSON_GONE} (3)`, RULE_PERSON_GONE, `${RULE_PERSON_GONE} (2)`]);
    // Deleting the first rule does not move the others' suffixes.
    const b = rulePeopleToNames(doc(config({ r: ids.slice(1) }), true), ROSTER).config;
    expect(b.restrictions.map((r) => r.person)).toEqual([RULE_PERSON_GONE, `${RULE_PERSON_GONE} (2)`]);
  });

  it("numbers a non-resolving label that would name someone", () => {
    const literal = { _id: "Lit00000000000000000001", member_name: RULE_PERSON_GONE, ministries: ["kids"] };
    const out = rulePeopleToNames(doc(config({ r: [GONE] }), true), [...ROSTER, literal]);
    expect(out.config.restrictions[0].person).toBe(`${RULE_PERSON_GONE} (2)`);
  });

  it("labels a name that only fails through spacing by its normalised display name, which names nobody", () => {
    const spaced = { _id: "Spc00000000000000000001", member_name: "Rex  Ruiz", ministries: ["worship"] };
    const out = rulePeopleToNames(doc(config({ r: [spaced._id] }), true), [...ROSTER, spaced]);
    expect(out.config.restrictions[0].person).toBe("Rex Ruiz");
    expect(out.back.get("rex ruiz")).toBe(spaced._id);
  });
});

describe("rulePeopleToIds", () => {
  const storedIds = doc(config({ r: [VALE, GONE], c: [[MKZ, GABY]], p: [[VALE, GABY]] }), true);

  it("names mode writes names as given", () => {
    const c = config({ r: ["vale 𑣲", "nadie"] });
    expect(rulePeopleToIds(c, doc(c, false), ROSTER)).toEqual({ ok: true, config: c });
  });

  it("id mode: a name resolves to its id, a label in `back` to its stored token", () => {
    const view = rulePeopleToNames(storedIds, ROSTER).config;
    const out = rulePeopleToIds({ ...view, restrictions: [{ ...view.restrictions[0], person: "vale 𑣲" }, view.restrictions[1]] }, storedIds, ROSTER);
    expect(out.ok && rulePeopleOf(out.config)).toEqual([VALE, GONE, MKZ, GABY, VALE, GABY]);
  });

  it("setMarker \"id\" re-keys a names document (the migration); setMarker null writes an id document as names", () => {
    const names = doc(config({ r: ["Vale 𑣲"], c: [["Mkz", "Gaby"]] }), false);
    const toIds = rulePeopleToIds(solverConfigFromDocument(names), names, ROSTER, "id");
    expect(toIds.ok && rulePeopleOf(toIds.config)).toEqual([VALE, MKZ, GABY]);
    const ids = doc(toIds.ok ? toIds.config : config({}), true);
    const back = rulePeopleToIds(solverConfigFromDocument(ids), ids, ROSTER, null);
    expect(back.ok && rulePeopleOf(back.config)).toEqual(["Vale 𑣲", "Mkz", "Gaby"]);
  });

  it("names mode never writes an id: a gone or outside id becomes its non-resolving label", () => {
    const ids = doc(config({ r: [KIDS_ANA, VALE] }), true);
    const out = rulePeopleToIds(solverConfigFromDocument(ids), ids, ROSTER, null);
    expect(out.ok && rulePeopleOf(out.config)).toEqual(["Ana (fuera de Alabanza)", "Vale 𑣲"]);
  });

  it("refuses a name two worship members share (ambiguous_person)", () => {
    const twin = { _id: "Twin00000000000000001", member_name: "Gaby", ministries: ["worship"] };
    const view = config({ r: ["Gaby"] });
    const out = rulePeopleToIds(view, storedIds, [...ROSTER, twin]);
    expect(out).toEqual({ ok: false, refusal: { path: "restrictions[0].person", person: "Gaby", reason: "ambiguous_person" } });
  });

  it("refuses someone outside Alabanza (not_worship)", () => {
    const out = rulePeopleToIds(config({ c: [["Mkz", "Luis"]] }), storedIds, ROSTER);
    expect(out).toEqual({ ok: false, refusal: { path: "conflicts[0].personB", person: "Luis", reason: "not_worship" } });
  });

  it("refuses a name that matches only once spacing is normalised (name_unmatched)", () => {
    const spaced = { _id: "Spc00000000000000000001", member_name: "Rex  Ruiz", ministries: ["worship"] };
    const out = rulePeopleToIds(config({ p: [["Mkz", "Rex Ruiz"]] }), storedIds, [...ROSTER, spaced]);
    expect(out).toEqual({ ok: false, refusal: { path: "presence[0].persons[1]", person: "Rex Ruiz", reason: "name_unmatched" } });
  });

  it("refuses the rename race: a name read before a Studio rename names nobody now (person_changed)", () => {
    const renamed = ROSTER.map((m) => (m._id === VALE ? { ...m, alias: "Valeria" } : m));
    const view = rulePeopleToNames(storedIds, ROSTER).config; // read while she was «Vale 𑣲»
    const out = rulePeopleToIds(view, storedIds, renamed);
    expect(out).toEqual({ ok: false, refusal: { path: "restrictions[0].person", person: "Vale 𑣲", reason: "person_changed" } });
  });

  it("keeps each id once in a presence list and refuses two exact caps that now fix one id", () => {
    const presence = rulePeopleToIds(config({ p: [["Vale 𑣲", "valeria sosa", "Mkz"]] }), storedIds, ROSTER);
    expect(presence.ok && presence.config.presence[0].persons).toEqual([VALE, MKZ]);
    const cap = (id: string) => ({ id, pattern: "Sun.Lead", op: "==" as const, value: 1, relative: false, relOffset: 0 });
    const c = config({ r: ["Vale 𑣲", "Valeria Sosa"] });
    c.restrictions[0].caps = [cap("k0")];
    c.restrictions[1].caps = [cap("k1")];
    expect(parseSolverConfigWrite(c).ok).toBe(true); // two texts: the name check cannot see it
    expect(rulePeopleToIds(c, storedIds, ROSTER)).toEqual({
      ok: false,
      refusal: { path: "restrictions[1].caps[0]", person: "Valeria Sosa", reason: "exact_overlap" },
    });
  });

  it("refuses an id posted as a name: ids never come in from a client", () => {
    const out = rulePeopleToIds(config({ r: [MKZ] }), storedIds, ROSTER);
    expect(out.ok).toBe(false);
  });
});

describe("the round trip", () => {
  // Production-shaped (2026-11-20, §1.6): 11 restrictions, 7 conflicts (one stored twice), 1 presence,
  // 13 people; plus a gone member, an outside-Alabanza member and a repeated person.
  const NAMES = ["Frank", "Mkz", "Gaby", "Rex", "Tony", "Andy", "Vale 𑣲", "Tay", "Liu", "Lucía", "Niza", "Hugo", "Jakey"];
  const people: RulePeopleRosterMember[] = NAMES.map((n, i) => ({
    _id: i % 2 ? `m${String(i).padStart(21, "0")}` : `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
    member_name: `${n} Apellido`,
    alias: n,
    ...(i % 3 ? { ministries: ["worship"] } : {}),
  }));
  const twin = { _id: "TwinA000000000000000001", member_name: "Tay Apellido", alias: "Tay", ministries: ["worship"] };
  const roster = [...people, twin, { _id: KIDS_ANA, member_name: "Ana", ministries: ["kids"] }];
  const idOf = (n: string) => people[NAMES.indexOf(n)]._id;
  const prod = config({
    r: ["Frank", "Mkz", "Gaby", "Rex", "Tony", "Andy", "Vale 𑣲", "Liu", "Lucía", "Niza", "Hugo"].map(idOf),
    c: [["Lucía", "Niza"], ["Jakey", "Hugo"], ["Jakey", "Hugo"], ["Frank", "Mkz"], ["Rex", "Tony"], ["Andy", "Liu"], ["Gaby", "Vale 𑣲"]].map(
      ([a, b]) => [idOf(a), idOf(b)] as [string, string],
    ),
    p: [[idOf("Hugo"), idOf("Jakey"), GONE, KIDS_ANA, twin._id, idOf("Tay")]],
  });

  it("an unchanged view, through JSON and the client's reader and parser, writes every token back byte-identical", () => {
    const stored = doc(prod, true);
    const { config: view } = rulePeopleToNames(stored, roster);
    expect(JSON.stringify(view)).not.toMatch(/0000|kidsMember|TwinA/);
    const parsed = parseSolverConfigWrite(viaClient(view));
    if (!parsed.ok) throw new Error(parsed.issues.join());
    const out = rulePeopleToIds(parsed.value.config, stored, roster);
    if (!out.ok) throw new Error(JSON.stringify(out.refusal));
    expect(solverConfigFields(out.config)).toEqual(solverConfigFields(prod));
  });

  it("in names mode too", () => {
    const named = doc(config({ r: NAMES.slice(0, 11), c: [["Lucía", "Niza"], ["Jakey", "Hugo"]], p: [["Hugo", "Jakey"]] }), false);
    const { config: view } = rulePeopleToNames(named, roster);
    const parsed = parseSolverConfigWrite(viaClient(view));
    if (!parsed.ok) throw new Error(parsed.issues.join());
    const out = rulePeopleToIds(parsed.value.config, named, roster);
    expect(out.ok && solverConfigFields(out.config)).toEqual(solverConfigFields(solverConfigFromDocument(named)));
  });

  it("labels survive double and trailing spaces and a different case in the client", () => {
    const stored = doc(prod, true);
    const { config: view } = rulePeopleToNames(stored, roster);
    const messy = { ...view, presence: view.presence.map((p) => ({ ...p, persons: p.persons.map((t) => `  ${t.toUpperCase().replace(/ /g, "  ")} `) })) };
    const parsed = parseSolverConfigWrite(viaClient(messy));
    if (!parsed.ok) throw new Error(parsed.issues.join());
    const out = rulePeopleToIds(parsed.value.config, stored, roster);
    expect(out.ok && out.config.presence).toEqual(prod.presence);
  });
});
