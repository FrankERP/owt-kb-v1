// app/components/admin/solverConfigDefaults.ts
//
// The first-run rule set, and NOTHING else.
//
// ─── What used to be here, and why it is gone ────────────────────────────────
//
// This file was `solverConfigStorage.ts`: the reader for `owt_solver_config_v3`,
// plus `isFirstRunSolverSeed`, a content-equality test that told "this browser
// holds the team's rules" apart from "this browser is showing the untouched
// seed". Both retired with the cutover — the rules now live in ONE Sanity
// document (`sanity/schemas/solverConfig.ts`), read through
// `useSolverConfig.ts`, and nothing reads or writes the browser key any more.
//
// The distinction that heuristic was approximating did NOT retire; it just stopped
// being a heuristic. "Is this the team's rule set or a stand-in?" is now answered
// by the server, as `SolverConfigSource`'s `ready` vs `absent` — see
// `solverConfigSource.ts`. `enforceableConfig` is where the consequence lives:
// only `ready` reaches the Tablero, so an absent document still cannot make that
// surface hard-block against rules nobody wrote.
//
// **The old booby trap is defused, and a smaller one replaced it.** Editing the
// literal below used to make every already-persisted seed start enforcing,
// retroactively, in browsers nobody could inspect. Nothing compares against it
// any more, so that is gone. What remains: this is what an environment with NO
// shared document shows and what the planner grid hard-blocks on there. It is
// never written anywhere by itself — only an explicit "Guardar reglas" writes,
// and a save is unrepresentable while the document is absent (there is no `_rev`
// to write under). Production HAS the document (seeded 2026-08-02 from the live
// capture, which differed from this constant in two material ways), so editing
// this changes nothing there.
//
// The stale `owt_solver_config_v3` values still sitting in admins' browsers are
// left alone on purpose: nothing reads them, so they cannot cause a split brain,
// and until the shared document has been through a few real edits they are the
// only independent copy of the rules that existed before the seed.

import type { SolverConfig } from "./plannerModel";

/**
 * The FIRST-RUN SEED — what an admin sees when no shared document exists yet.
 * Mirrors the production rules in `CGPT_owt_roles.py` as they stood when the
 * generator shipped.
 *
 * **In memory only.** `MonthGenerator` shows it while `SolverConfigSource` is
 * `absent`, and nothing persists it: the save control has no revision to write
 * under in that state, and the route refuses a create outright so that only the
 * seed script can mint the shared document.
 */
export const DEFAULT_SOLVER_CONFIG: SolverConfig = {
  sundayLeads: [], saturdayLeads: [], support: [],
  restrictions: [
    {
      id: "d-frank", person: "Frank",
      excludedPatterns: ["Sat.*", "Sun.BGV", "Sun.Choir"],
      fairness: "exempt", fairnessSlack: 1,
      weekExclusions: [], caps: [],
    },
    {
      id: "d-mkz", person: "Mkz",
      excludedPatterns: ["Sat.*", "Sun.BGV", "Sun.Choir"],
      fairness: "exempt", fairnessSlack: 1,
      weekExclusions: [], caps: [],
    },
    {
      id: "d-gaby", person: "Gaby",
      // Merges both Gaby lines: !in Sat.* + !in Sun.Choir + slack 1 + Sun.BGV <= {weeks-2}
      excludedPatterns: ["Sat.*", "Sun.Choir"],
      fairness: "slack", fairnessSlack: 1,
      weekExclusions: [],
      caps: [{ id: "d-gaby-cap", pattern: "Sun.BGV", op: "<=", value: 0, relative: true, relOffset: 2 }],
    },
    {
      id: "d-lucia-week", person: "Lucía",
      excludedPatterns: [], fairness: "none", fairnessSlack: 1,
      weekExclusions: [{ id: "d-lucia-w3", week: 3, pattern: "*.*" }], caps: [],
    },
    {
      id: "d-liu-week", person: "Liu",
      excludedPatterns: [], fairness: "none", fairnessSlack: 1,
      weekExclusions: [{ id: "d-liu-w3", week: 3, pattern: "*.*" }], caps: [],
    },
    {
      id: "d-marianne-week", person: "Marianne",
      excludedPatterns: [], fairness: "none", fairnessSlack: 1,
      weekExclusions: [{ id: "d-marianne-w1", week: 1, pattern: "*.*" }], caps: [],
    },
  ],
  conflicts: [
    { id: "d-lucia-niza",     personA: "Lucía", personB: "Niza",  pattern: "*.LeadBGV" },
    { id: "d-hugo-lucia",     personA: "Hugo",  personB: "Lucía", pattern: "*.Lead"    },
    { id: "d-niza-hugo",      personA: "Niza",  personB: "Hugo",  pattern: "*.Lead"    },
    { id: "d-jakey-hugo-bgv", personA: "Jakey", personB: "Hugo",  pattern: "*.BGV"     },
    { id: "d-jakey-hugo-lead",personA: "Jakey", personB: "Hugo",  pattern: "*.Lead"    },
  ],
  presence: [
    { id: "d-hugo-jakey", persons: ["Hugo", "Jakey"], pattern: "Sun.BGV" },
  ],
};
