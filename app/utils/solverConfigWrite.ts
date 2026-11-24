// app/utils/solverConfigWrite.ts
//
// THE write of the shared planner rules (`solverConfig`): ADR-0049's one chain plus ADR-0092's
// translation of rule people. `parseSolverConfigWrite` → `rulePeopleToIds` (in the TARGET mode) →
// `solverConfigFields` (+ the `personTokens` marker, only when `setMarker` is passed) → one patch
// under `ifRevisionId`.
//
// NEUTRAL, NOT `server-only`, with no module-level client: `solverConfigCommit.ts` (the rules POST and
// the chat's rule tools) hands it `writeClient`, and the consented migration script
// (`scripts/rekey-solver-rule-people.ts`, run with `npx tsx`) hands it its own. Same precedent as C4's
// `executeFairnessMonthWrites`. Only those two may import it (`solverConfigReadCoverage.test.ts`).
//
// Why the marker is written ONLY here and only with `setMarker`: a client save carries names and the
// six rule fields; it can neither set nor clear `personTokens`, so no ordinary save can flip storage
// before Frank saw the migration's dry run (ADR-0092, «converting on every save» rejected).

import type { SanityClient } from "@sanity/client";
import type { SolverConfig } from "@/app/components/admin/plannerModel";
import {
  PERSON_TOKENS_ID,
  SOLVER_CONFIG_DOC_ID,
  parseSolverConfigWrite,
  rulePeopleToIds,
  rulePeopleToNames,
  solverConfigFields,
  type RulePeopleRosterMember,
  type RulePersonRefusal,
} from "./solverConfigWriteRequest";

export type SolverConfigMarker = typeof PERSON_TOKENS_ID | null;

export interface SolverConfigWriteInput {
  /** The rules as names (a client body's `config`, the chat's applied edits, the migration's view). */
  config: unknown;
  /** The stored document, FRESHLY read: its marker is the write's mode, its ids the labels' targets. */
  stored: unknown;
  /** `rulePeopleRosterQuery()`'s rows, read with `stored`. */
  roster: readonly RulePeopleRosterMember[];
  /** Only the migration passes it: `"id"` re-keys to ids and sets the marker, `null` writes names and clears it. */
  setMarker?: SolverConfigMarker;
}

export type PreparedSolverConfigWrite =
  | {
      ok: true;
      /** The parsed rules, as names: what the caller judges and answers with. */
      config: SolverConfig;
      /** The rules as stored after this write (ids in id mode). */
      written: SolverConfig;
      /** The six rule fields (+ `personTokens: "id"` when `setMarker` is `"id"`), each item with its `_key`. */
      fields: Record<string, unknown>;
    }
  | { ok: false; kind: "invalid"; issues: string[] }
  | { ok: false; kind: "person"; refusal: RulePersonRefusal };

/** Everything the write will set, nothing written. Pure. */
export function prepareSolverConfigWrite(input: SolverConfigWriteInput): PreparedSolverConfigWrite {
  const parsed = parseSolverConfigWrite(input.config);
  if (!parsed.ok) return { ok: false, kind: "invalid", issues: parsed.issues };
  const keyed = rulePeopleToIds(parsed.value.config, input.stored, input.roster, input.setMarker);
  if (!keyed.ok) return { ok: false, kind: "person", refusal: keyed.refusal };
  return {
    ok: true,
    config: parsed.value.config,
    written: keyed.config,
    fields: {
      ...solverConfigFields(keyed.config),
      ...(input.setMarker === PERSON_TOKENS_ID ? { personTokens: PERSON_TOKENS_ID } : {}),
    },
  };
}

export interface SolverConfigStamp {
  updatedAt: string;
  updatedBy?: string;
}

/**
 * The one patch: the prepared fields and the stamp under `ifRevisionId(rev)`; `personTokens` unset when
 * `clearMarker`. Throws on any failure (a 409 included): the caller classifies.
 */
export async function commitSolverConfigFields(
  client: Pick<SanityClient, "patch">,
  rev: string,
  fields: Record<string, unknown>,
  stamp: SolverConfigStamp,
  clearMarker = false,
): Promise<void> {
  let patch = client.patch(SOLVER_CONFIG_DOC_ID).ifRevisionId(rev).set({ ...fields, ...stamp });
  if (clearMarker) patch = patch.unset(["personTokens"]);
  await patch.commit();
}

/** Prepare, then commit when it is clean. A refusal writes nothing; a commit failure throws. */
export async function writeSolverConfig(
  client: Pick<SanityClient, "patch">,
  input: SolverConfigWriteInput & { rev: string; stamp: SolverConfigStamp },
): Promise<PreparedSolverConfigWrite> {
  const prepared = prepareSolverConfigWrite(input);
  if (!prepared.ok) return prepared;
  await commitSolverConfigFields(client, input.rev, prepared.fields, input.stamp, input.setMarker === null);
  return prepared;
}

// ── The lossless gate (ADR-0084 R4), shared with the migration script ────────

/** The six rule fields a save writes (the marker and the stamp are not rule fields). */
export const RULE_FIELDS = ["sundayLeads", "saturdayLeads", "support", "restrictions", "conflicts", "presence"] as const;

/** JSON with object keys sorted: the lossless gate ignores key order, nothing else. */
export function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${sortedJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * R4: the stored rules as the panel would re-save them (as NAMES), or `null` when that would change any
 * stored field. ADR-0092: the comparison stays against the RAW stored fields, through the one write core,
 * so a coercion by the lenient reader is `lossy` in either mode, and so is an id-mode document whose
 * labels would not come back to the same ids.
 */
export function losslessRules(raw: Record<string, unknown>, roster: readonly RulePeopleRosterMember[]): SolverConfig | null {
  const view = rulePeopleToNames(raw, roster).config;
  const prepared = prepareSolverConfigWrite({ config: view, stored: raw, roster });
  if (!prepared.ok) return null;
  for (const field of RULE_FIELDS) {
    if (sortedJson(raw[field]) !== sortedJson(prepared.fields[field])) return null;
  }
  return prepared.config;
}
