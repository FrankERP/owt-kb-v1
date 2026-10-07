// The fictitious world of solver v3 C4's tests (spec R23) — NOT a test file. Every name
// is invented. Rule keys and one member `_id` have production's SEED shape
// (`d-<first-name>`, `kidsMember-<slug>`), so the key-hygiene test checks the identifier
// shape production really has, not only opaque ids (R12).
//
// People (worship roster unless noted):
//   Ana Ejemplo    m-ana            voz+sunday_lead, ministries absent; rule d-ana excludes Sat.*; a Sat.BGV seat on 1 Aug
//   Beto Ejemplo   m-beto           voz+sunday_lead, ["worship"]; Sun.BGV == 1 (rule r7k2, cap c1q9); holds 0 in August
//   Carla Ejemplo  m-carla          voz+support, ministries []; newcomer: first BGV seat 13 Sep (mid-month); not ticked today
//   Dani Ejemplo   kidsMember-dani  voz+sunday_lead, ["kids","worship"]; «Mes por medio» (rule c9p4); one Sunday lead (19 Jul)
//   Elena Ejemplo  m-elena          voz+sunday_lead; ticked in today's Sunday pool and never seated
//   Fausto Ejemplo m-fausto         sunday_lead only — no voz; a Sun.BGV seat on 13 Sep; the corrections file adds him
//   Iván Ejemplo   m-ivan           voz+saturday_lead; a week-2 Saturday exclusion (rule w3x8, e5m1)
//   Greta Ejemplo  m-greta          voz+support, ["kids"] — kids-only, ticked (stale) in support; never on the worship roster
//   m-hugo                          no member document (deleted); a Sun.BGV seat on 2 Aug
// Presence d-beto-carla (Beto + Carla on Sun.BGV); conflict d-ana-beto (Ana, Beto, Sun.Lead) — so the pair is not exclusive.
// Records: June manual, July reconstructed and intact (content differs; holds a date Ana has since deleted),
// September reconstructed then hand-edited. August has none.

import type { PersonRestriction, RestrictionCap, SolverConfig } from "@/app/components/admin/plannerModel";
import type { FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { buildFairnessMonthDocument } from "@/app/utils/fairnessMonthWriteRequest";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import { buildSolverConfigDocument } from "@/app/utils/solverConfigWriteRequest";

export const NOW = "2026-10-20T18:00:00.000Z";
export const MONTHS = "2026-06,2026-07,2026-08,2026-09";

/** Every fictitious name and alias of this world — none may reach stdout or stderr (R12). */
export const NAMES = [
  "Ana Ejemplo", "Ana E.", "Beto Ejemplo", "Beto E.", "Carla Ejemplo", "Carla E.", "Dani Ejemplo", "Dani E.",
  "Elena Ejemplo", "Elena E.", "Fausto Ejemplo", "Fausto E.", "Iván Ejemplo", "Iván E.", "Greta Ejemplo", "Greta E.",
];
/** Every member `_id` of this world. */
export const MEMBER_IDS = ["m-ana", "m-beto", "m-carla", "kidsMember-dani", "m-elena", "m-fausto", "m-ivan", "m-greta", "m-hugo"];
/** Every `solverConfig` rule id of this world (restrictions, caps, week exclusion, conflict, presence). */
export const RULE_KEYS = ["d-ana", "r7k2", "c1q9", "c9p4", "w3x8", "e5m1", "d-ana-beto", "d-beto-carla"];

export const member = (id: string, member_name: string, alias: string, memberType: string[], extra: Record<string, unknown> = {}): FakeDoc => ({
  _id: id,
  _type: "teamMembers",
  member_name,
  alias,
  memberType,
  ...extra,
});

export const MEMBERS: FakeDoc[] = [
  member("m-ana", "Ana Ejemplo", "Ana E.", ["voz", "sunday_lead"], { unavailableDates: ["2026-08-15"] }),
  member("m-beto", "Beto Ejemplo", "Beto E.", ["voz", "sunday_lead"], { ministries: ["worship"], unavailableDates: ["2026-07-26", "2025-12-25"] }),
  member("m-carla", "Carla Ejemplo", "Carla E.", ["voz", "support"], { ministries: [], unavailableDates: ["2026-09-13"] }),
  member("kidsMember-dani", "Dani Ejemplo", "Dani E.", ["voz", "sunday_lead"], { ministries: ["kids", "worship"] }),
  member("m-elena", "Elena Ejemplo", "Elena E.", ["voz", "sunday_lead"]),
  member("m-fausto", "Fausto Ejemplo", "Fausto E.", ["sunday_lead"]),
  member("m-ivan", "Iván Ejemplo", "Iván E.", ["voz", "saturday_lead"]),
  member("m-greta", "Greta Ejemplo", "Greta E.", ["voz", "support"], { ministries: ["kids"] }),
];

export const restriction = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id,
  person,
  excludedPatterns: [],
  fairness: "none",
  fairnessSlack: 1,
  weekExclusions: [],
  caps: [],
  ...patch,
});
export const cap = (id: string, pattern: string, value: number, patch: Partial<RestrictionCap> = {}): RestrictionCap => ({
  id,
  pattern,
  op: "==",
  value,
  relative: false,
  relOffset: 0,
  ...patch,
});

export const WORLD_CONFIG: SolverConfig = {
  sundayLeads: ["kidsMember-dani", "m-ana", "m-beto", "m-elena"],
  saturdayLeads: ["m-ivan"],
  support: ["m-greta"],
  restrictions: [
    restriction("d-ana", "Ana Ejemplo", { excludedPatterns: ["Sat.*"] }),
    restriction("r7k2", "Beto Ejemplo", { caps: [cap("c1q9", "Sun.BGV", 1)] }),
    restriction("c9p4", "Dani Ejemplo", { sundayCadence: "alternate" }),
    restriction("w3x8", "Iván Ejemplo", { weekExclusions: [{ id: "e5m1", week: 2, pattern: "Sat.*" }] }),
  ],
  conflicts: [{ id: "d-ana-beto", personA: "Ana Ejemplo", personB: "Beto Ejemplo", pattern: "Sun.Lead" }],
  presence: [{ id: "d-beto-carla", persons: ["Beto Ejemplo", "Carla Ejemplo"], pattern: "Sun.BGV" }],
};

/** The stored singleton, built by C2/C3's own serializer (never a hand-written shape). */
export function configDoc(config: SolverConfig = WORLD_CONFIG): FakeDoc {
  return buildSolverConfigDocument({ config, now: "2026-10-01T00:00:00.000Z" }) as unknown as FakeDoc;
}

const refs = (ids: string[] = []) => ids.map((id, i) => ({ _key: `k${i}`, _type: "reference", _ref: id }));
type Seats = { Lead?: string[]; BGVs?: string[]; Chorus?: string[] };
const weekend = (id: string, type: "sunday_role" | "saturday_role", week: string, seats: Seats, extra: Record<string, unknown> = {}): FakeDoc => ({
  _id: id,
  _type: type,
  week,
  published: true,
  Lead: refs(seats.Lead),
  BGVs: refs(seats.BGVs),
  Chorus: refs(seats.Chorus),
  ...extra,
});
const special = (id: string, date: string, name: string, seats: Seats, extra: Record<string, unknown> = {}): FakeDoc => ({
  _id: id,
  _type: "special_role",
  date,
  service_name: name,
  published: true,
  Lead: refs(seats.Lead),
  BGVs: refs(seats.BGVs),
  Chorus: refs(seats.Chorus),
  ...extra,
});

export const SERVICES: FakeDoc[] = [
  weekend("sun-2026-07-05", "sunday_role", "2026-07-05", { Lead: ["m-ana"], BGVs: ["m-beto"] }),
  weekend("sat-2026-07-11", "saturday_role", "2026-07-11", { Lead: ["m-ivan"] }),
  weekend("sun-2026-07-19", "sunday_role", "2026-07-19", { Lead: ["kidsMember-dani"], Chorus: ["m-ana"] }),
  weekend("sat-2026-08-01", "saturday_role", "2026-08-01", { Lead: ["m-ivan"], BGVs: ["m-ana"] }),
  weekend("sun-2026-08-02", "sunday_role", "2026-08-02", { Lead: ["m-ana"], BGVs: ["m-hugo"] }),
  special("spe-2026-08-08", "2026-08-08", "Campamento", { Lead: ["m-ivan"] }, { countsForFairness: true }),
  weekend("sun-2026-08-16-a", "sunday_role", "2026-08-16", { Lead: ["m-ana"], BGVs: ["m-carla"] }),
  weekend("sun-2026-08-16-b", "sunday_role", "2026-08-16", { Lead: ["m-beto"] }),
  weekend("sat-2026-08-22", "saturday_role", "2026-08-22", { Lead: ["m-ivan"], BGVs: ["m-beto"] }, { published: false }),
  special("spe-2026-08-30", "2026-08-30", "Bautizos", { Chorus: ["m-carla"] }),
  weekend("sun-2026-09-06", "sunday_role", "2026-09-06", { Lead: ["m-ana"], BGVs: ["m-beto"] }),
  weekend("sun-2026-09-13", "sunday_role", "2026-09-13", { Lead: ["m-ana"], BGVs: ["m-carla", "m-fausto"], Chorus: ["m-ana"] }),
  weekend("sat-2026-09-19", "saturday_role", "2026-09-19", { Lead: ["m-ivan"] }),
];

/** Draft overlays the builders must never read (R3: canonical documents only). */
export const DRAFTS: FakeDoc[] = [
  weekend("drafts.sun-2026-09-06", "sunday_role", "2026-09-06", { Lead: ["m-elena"] }),
  member("drafts.m-elena", "Elena Ejemplo", "Elena E.", []),
];

const ALIAS = new Map([
  ["m-ana", "Ana E."],
  ["m-beto", "Beto E."],
  ["m-carla", "Carla E."],
  ["kidsMember-dani", "Dani E."],
  ["m-elena", "Elena E."],
  ["m-fausto", "Fausto E."],
  ["m-ivan", "Iván E."],
]);
const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const item = (memberId: string, roles: Partial<Record<RoleKey, Status>>, extra: Partial<FairnessMonthBody["people"][number]> = {}) => ({
  memberId,
  roles: { ...OUT, ...roles },
  exactRules: [],
  exempt: false,
  blocks: [],
  ...extra,
});

/** A stored record, built by C2's own document builder (C4 never builds one; tests may). */
export const storedRecord = (body: FairnessMonthBody, source: "manual" | "reconstructed", rev: string): FakeDoc =>
  ({
    ...buildFairnessMonthDocument({
      body,
      source,
      engine: source === "reconstructed" ? "v2" : "v3",
      environment: "local",
      recordedAt: "2026-10-02T00:00:00.000Z",
      recordedBy: source === "reconstructed" ? "script:reconstruct-fairness-months" : "m-beto",
      names: ALIAS,
    }),
    _rev: rev,
  }) as unknown as FakeDoc;

/** June: another writer's record → «no lo escribió la reconstrucción: no se toca». */
export const JUNE_MANUAL = storedRecord({ month: "2026-06", people: [item("m-ana", {})], presence: [] }, "manual", "rev-jun");

/** July: intact, reconstructed, different content → «reemplazar»; it holds 12 Jul for Ana, a date she has since deleted. */
export const JULY_RECONSTRUCTED = storedRecord(
  { month: "2026-07", people: [item("m-ana", { "Sun.Lead": "in" }, { blocks: [{ date: "2026-07-12", unavailable: true, excludedRoles: [] }] })], presence: [] },
  "reconstructed",
  "rev-jul",
);

/** September exactly as the run computes it with the corrections file … */
export const SEPTEMBER_BODY: FairnessMonthBody = {
  month: "2026-09",
  people: [
    item("kidsMember-dani", { "Sun.Lead": "in" }, { sundayCadence: "alternate" }),
    item("m-ana", { "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "in" }),
    item("m-beto", { "Sun.BGV": "exact", "Sat.BGV": "in" }, { exactRules: [{ roles: ["Sun.BGV"], count: 1 }] }),
    item("m-carla", { "Sun.BGV": "in", "Sat.BGV": "in" }, {
      blocks: [
        { date: "2026-09-06", unavailable: true, excludedRoles: [] },
        { date: "2026-09-13", unavailable: true, excludedRoles: [] },
      ],
    }),
    item("m-elena", {}),
    item("m-fausto", { "Sun.BGV": "in" }),
    item("m-ivan", { "Sat.Lead": "in" }, { blocks: [{ date: "2026-09-12", unavailable: false, excludedRoles: ["Sat.Lead", "Sat.BGV", "Sat.Choir"] }] }),
  ],
  presence: [{ ruleKey: "d-beto-carla", roles: ["Sun.BGV"], members: ["m-beto", "m-carla"], exclusive: false }],
};

/** … then hand-edited after it was written (Elena's Sun.Lead) → «editado después de reconstruir: no se toca». */
export const SEPTEMBER_EDITED: FakeDoc = (() => {
  const doc = storedRecord(SEPTEMBER_BODY, "reconstructed", "rev-sep") as unknown as { people: Array<{ member: { _ref: string }; roles: Record<string, string> }> };
  const elena = doc.people.find((p) => p.member._ref === "m-elena");
  if (elena) elena.roles.sunLead = "in";
  return doc as unknown as FakeDoc;
})();

/** The corrections file of the main run: an added person, a mid-month newcomer's blocked date, an out-of-run month. */
export const OVERRIDES = JSON.stringify(
  {
    schemaVersion: 1,
    members: {
      "m-fausto": { note: "Cantó en septiembre; hoy su Tipo ya no tiene voz.", months: { "2026-09": { roles: { "Sun.BGV": "in" } } } },
      "m-carla": { note: "Llegó a mitad de septiembre.", blockedDates: [{ date: "2026-09-06" }] },
      "m-ivan": { months: { "2026-10": { roles: { "Sat.BGV": "in" } } } },
    },
  },
  null,
  2,
);

export function worldDocs(opts: { config?: SolverConfig | null; without?: string[]; extra?: FakeDoc[] } = {}): FakeDoc[] {
  const config = opts.config === null ? [] : [configDoc(opts.config ?? WORLD_CONFIG)];
  const without = new Set(opts.without ?? []);
  const all = [...MEMBERS, ...SERVICES, ...DRAFTS, JUNE_MANUAL, JULY_RECONSTRUCTED, SEPTEMBER_EDITED, ...config];
  return [...all.filter((d) => !without.has(d._id)), ...(opts.extra ?? [])];
}
