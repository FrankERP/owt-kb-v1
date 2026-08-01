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
// ─── WHY THE FIRST-RUN SEED LIVES HERE ───────────────────────────────────────
//
// "This browser holds rules" is NOT "this key exists": the generator persisted
// its whole state on mount, and that state starts as `DEFAULT_SOLVER_CONFIG`,
// so the key is already present in every browser that ever opened "Generar
// mes". `isFirstRunSolverSeed` is the actual test, and it needs the seed — so
// the seed is defined here and `MonthGenerator` imports it, rather than the
// other way round.
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
 * The FIRST-RUN SEED — what an admin sees before anybody has written a rule.
 * Mirrors the production rules in `CGPT_owt_roles.py` as they stood when the
 * generator shipped.
 *
 * It lives HERE, not in `MonthGenerator`, because this module is what has to
 * tell "this browser holds the team's rules" apart from "this browser is
 * showing the seed" — see {@link isFirstRunSolverSeed}. `MonthGenerator`
 * imports it back as its initial state.
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

/** Key-order-independent JSON, so "is this the seed?" cannot turn on field order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const SEED_JSON = stableJson(DEFAULT_SOLVER_CONFIG);

/**
 * Is this value the untouched first-run seed rather than a rule set somebody
 * wrote?
 *
 * **Why an equality test and not "a key exists".** `MonthGenerator` used to
 * write its whole state to `localStorage` on mount, and that state starts as
 * {@link DEFAULT_SOLVER_CONFIG} — so every admin who has ever OPENED "Generar
 * mes" has the seed persisted, whether or not they ever wrote a rule. "The key
 * exists" therefore says nothing at all about whether this team wrote anything,
 * and taking it as evidence is how the Tablero would start hard-blocking picks
 * against six restrictions, five conflicts and a presence rule nobody chose.
 * The generator no longer writes the untouched seed (`MonthGenerator.tsx`), but
 * that only helps browsers from here on: the seed is already sitting in the
 * browsers that matter, and this test is what makes it harmless there too —
 * retroactively, with nothing to migrate.
 *
 * The one thing it gives up: a team whose rules are byte-identical to the seed
 * is read as "no rules". That is the SAFE side of an indistinguishable pair —
 * it under-enforces on a surface that has always enforced nothing, rather than
 * inventing refusals — and the alternative (trusting the key) over-enforces on
 * every browser at once.
 */
export function isFirstRunSolverSeed(config: SolverConfig): boolean {
  return stableJson(config) === SEED_JSON;
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
 * A stored value that is exactly the first-run seed answers `null` too, for the
 * reason {@link isFirstRunSolverSeed} states. `MonthGenerator` is unaffected by
 * that branch: its state is already that same seed, so "no stored rules" and
 * "the stored rules are the seed" render identically there.
 *
 * Never throws: a corrupt value, a disabled storage API, or a server render all
 * answer `null`.
 */
export function readStoredSolverConfig(): SolverConfig | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const saved = localStorage.getItem(SOLVER_CONFIG_STORAGE_KEY);
    if (!saved) return null;
    const config = normalizeStoredSolverConfig(JSON.parse(saved));
    if (!config || isFirstRunSolverSeed(config)) return null;
    return config;
  } catch {
    return null;
  }
}
