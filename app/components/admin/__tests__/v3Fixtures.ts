// app/components/admin/__tests__/v3Fixtures.ts
//
// Shared by the solver-v3 planner suites — NOT a test file (no `.test.` in the name). Fictitious
// people only (the repository is public). `NAME_SHAPED` has keys of production's SEED SHAPE
// (`d-<name>-<name>`, C6 spec §3) built from those fictitious names, for the key-hygiene tests:
// none of its keys may ever reach a request, a rendered line, a log or KH-3's table.
import type { PersonRestriction, RestrictionCap, SolverConfig } from "../plannerModel";

export const ANA = { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"] };
export const BRUNO = { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "sunday_lead"] };
export const CARLA = { _id: "m-carla", member_name: "Carla Soto", alias: "Carla", memberType: ["voz", "saturday_lead"] };
export const DANI = { _id: "m-dani", member_name: "Dani Vega", alias: "Dani", memberType: ["voz", "support"] };
export const MEMBERS = [ANA, BRUNO, CARLA, DANI];

export const cap = (
  id: string, pattern: string, op: RestrictionCap["op"], value: number, extra: Partial<RestrictionCap> = {},
): RestrictionCap => ({ id, pattern, op, value, relative: false, relOffset: 0, ...extra });

export const restriction = (id: string, person: string, extra: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 0, weekExclusions: [], caps: [], ...extra,
});

export const config = (extra: Partial<SolverConfig> = {}): SolverConfig => ({
  sundayLeads: [], saturdayLeads: [], support: [], restrictions: [], conflicts: [], presence: [], ...extra,
});

/** `restrictions[1].caps[2]`, `conflicts[0]` and `presence[0]` are all name-shaped. */
export const NAME_SHAPED: SolverConfig = config({
  sundayLeads: ["m-ana", "m-bruno"],
  saturdayLeads: ["m-carla"],
  support: ["m-dani"],
  restrictions: [
    restriction("d-ana", "Ana", { caps: [cap("d-ana-sun-lead", "Sun.Lead", "<=", 2)] }),
    restriction("d-bruno", "Bruno", {
      caps: [cap("d-bruno-a", "Sun.BGV", "<=", 3), cap("d-bruno-b", "Sat.BGV", ">=", 0), cap("d-bruno-dani", "Sun.Lead", "<=", 1)],
    }),
  ],
  conflicts: [{ id: "d-ana-bruno", personA: "Ana", personB: "Bruno", pattern: "*.*" }],
  presence: [{ id: "d-carla-dani", persons: ["Carla", "Dani"], pattern: "Sun.BGV" }],
});
export const NAME_SHAPED_KEYS = [
  "d-ana", "d-ana-sun-lead", "d-bruno", "d-bruno-a", "d-bruno-b", "d-bruno-dani", "d-ana-bruno", "d-carla-dani",
];
