// app/utils/countsForFairness.ts
//
// THE read rule for a role document's «Cuenta para equidad» (solver v3 C1, parent L1):
// one GROQ fragment, one TypeScript twin, one type default. No other file spells the
// fragment or the default. Under v2 nothing computes with it; C2's ledger is the
// first reader, and the GET /api/admin/roles row is the planner's.
//
// NEUTRAL (ADR-0028): no "use client", no server-only import, no Sanity client and no
// imports at all, so route handlers, the server-only receipt module, C2's ledger and
// client components can all import it. It runs no query, so the protected-read audit
// yields no site for it.
//
// The fragment is a PLAIN quoted string on purpose, never a template literal:
// draftGatingCoverage.test.ts reads every template literal outside __tests__ that
// names a role type, and this module sits outside its exempt prefixes. A query that
// embeds the fragment interpolates the constant into its own literal.

export type FairnessRoleType = "sunday_role" | "saturday_role" | "special_role";

/** The GROQ read rule: the stored flag, else the type default (weekends count, specials do not). */
export const COUNTS_FOR_FAIRNESS_GROQ = 'coalesce(countsForFairness, _type != "special_role")';

/** The type default (parent D14): Sunday and Saturday services count, specials do not. */
export function countsForFairnessDefault(roleType: FairnessRoleType): boolean {
  return roleType !== "special_role";
}

/**
 * The TypeScript twin of COUNTS_FOR_FAIRNESS_GROQ: the stored value when it is a
 * boolean, the type default when it is absent or null. Agrees with the fragment on
 * every (absent | null | true | false) x role type pair — countsForFairness.test.ts
 * evaluates both with groq-js.
 */
export function countsForFairness(doc: { _type: string; countsForFairness?: boolean | null }): boolean {
  if (typeof doc.countsForFairness === "boolean") return doc.countsForFairness;
  return doc._type !== "special_role";
}
