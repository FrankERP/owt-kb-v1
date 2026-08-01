// app/components/admin/solverConfigStorage.ts
//
// The `localStorage` rule set — read and normalise, in ONE place.
//
// ─── What this is, and what it is NOT, as of Task 9 ──────────────────────────
//
// `localStorage` is **still the authoritative rule set**. Task 9 built the
// shared Sanity document (`sanity/schemas/solverConfig.ts`), the admin-gated
// route (`app/api/admin/solver-config/route.ts`) and the seed script, but the
// cutover — seed from the live browser capture, then retire this key — is a
// separate, user-gated step. Until it runs, this module is where the rules come
// from, and `app/api/admin/solver-config` is a mechanism nothing reads yet.
//
// This module exists so that cutover is ONE edit rather than two divergent ones:
// `MonthGenerator` (which has always read this key) and `ServicesPanel` (which
// now feeds the same rules to `SeatBoard`, so the Tablero enforces exactly what
// the planner grid enforces) both go through it.
//
// ─── DO NOT DELETE THE NORMALISER ────────────────────────────────────────────
//
// This guard has only ever checked two of the six fields, and `conflicts` /
// `presence` were added to `SolverConfig` after this key was first written — so
// a config persisted before then is still sitting in an admin's browser with
// those fields `undefined` while the type asserts they are arrays.
//
// Normalising here is the ONLY thing standing between that value and a white
// screen on the CONFIG STEP'S OWN FIRST RENDER — before any grid exists, before
// anything is clicked. `MemberPool` reads `config[field].length` and `.includes`
// (`MonthGenerator.tsx:264`, `:289`, `:290`, `:295`) for `saturdayLeads`/
// `support`, and `RuleBuilder` reads `config.restrictions/conflicts/presence` at
// `:727` and `:802`/`:814`/`:826`. Both iterate the raw prop; `ruleEnforcement`'s
// `ruleLists` guards its OWN reads and is on neither path, so it is not a second
// lock behind this one. (The grid path — `rankCandidates` during render, E6 — is
// guarded there as well; the config step is not guarded anywhere else.)
//
// It is pinned by `MonthGenerator.create.test.tsx` ("legacy persisted config"),
// which renders the generator over a `conflicts`/`presence`-less value and fails
// at `render` if this normalisation goes away.

import type { SolverConfig } from "./plannerModel";

/** The browser key. `v3` is historical; nothing versions on it. */
export const SOLVER_CONFIG_STORAGE_KEY = "owt_solver_config_v3";

/**
 * A parsed `localStorage` value as a complete `SolverConfig`, or `null` if it is
 * not recognisably one.
 *
 * The two `Array.isArray` checks are the ORIGINAL acceptance test, kept exactly:
 * widening it would start accepting values the generator has always ignored, and
 * narrowing it would start rejecting an admin's live rules. Everything after the
 * checks is the defaulting that makes the accepted value safe to render.
 */
export function normalizeStoredSolverConfig(parsed: unknown): SolverConfig | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Partial<SolverConfig>;
  if (!Array.isArray(p.sundayLeads) || !Array.isArray(p.restrictions)) return null;
  return {
    ...(p as SolverConfig),
    sundayLeads: p.sundayLeads ?? [],
    saturdayLeads: p.saturdayLeads ?? [],
    support: p.support ?? [],
    restrictions: p.restrictions ?? [],
    conflicts: p.conflicts ?? [],
    presence: p.presence ?? [],
  };
}

/**
 * The stored rule set, or `null` when this browser holds none.
 *
 * **`null` means "no rules here", never "use the defaults".** `MonthGenerator`
 * seeds its own state from `DEFAULT_SOLVER_CONFIG` and leaves it alone on a
 * `null`; `ServicesPanel` passes `undefined` straight through to `SeatBoard`,
 * which then enforces nothing — the behaviour that surface has always had. A
 * browser with no rules must not start hard-blocking picks against a rule set
 * nobody in this team ever wrote.
 *
 * Never throws: a corrupt value, a disabled storage API, or a server render all
 * answer `null`.
 */
export function readStoredSolverConfig(): SolverConfig | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const saved = localStorage.getItem(SOLVER_CONFIG_STORAGE_KEY);
    if (!saved) return null;
    return normalizeStoredSolverConfig(JSON.parse(saved));
  } catch {
    return null;
  }
}
