// scripts/lib/sr-retired-writer.mjs
//
// Fail-closed retirement gate for the one-shot executable writers that touch the
// Service Readiness protected types (plan §8:
// docs/superpowers/plans/2026-07-18-service-readiness-mutation-integrity.md).
//
// The plan is explicit: "Documentation-only retirement is insufficient; a script
// that cannot use the shared invariant must fail before any production write."
//
// Each of these five scripts is a HISTORICAL one-shot that has already been
// applied to production, and none of them can adopt the guarded invariant the
// runtime writers now use (target locks, creation receipts, exact observed
// revisions, the dependency policy). So they are retired in code, not in prose:
// `assertRetiredWriter()` runs at the very top of each file — before any client
// is constructed and before any mutation is built — and exits non-zero.
//
// The shared invariant is still REUSED rather than re-implemented: the decision
// runs `evaluateGuards()` from `sr-verification.mjs`, so the production project
// (`ebb8vcnk`) and dataset (`production`) are hard refusals on either axis, in
// dry-run too. On top of that a `retired_writer` hard failure is ALWAYS present,
// which makes `refused` unconditionally true and `willContactRemote`
// unconditionally false: there is no environment, flag, or argument that lets one
// of these scripts reach the Content Lake again.
//
// `evaluateRetiredWriter` and `formatRetirementRefusal` are PURE (no network, no
// filesystem, no process access); `assertRetiredWriter` is the thin print-and-
// exit wrapper the scripts call.

import { evaluateGuards } from "./sr-verification.mjs";

/**
 * The retired one-shot writers, keyed by script basename (no extension), with
 * what each used to do and where its behaviour lives now.
 */
export const RETIRED_WRITERS = Object.freeze({
  "import-schedule": {
    file: "scripts/import-schedule.ts",
    did: "create-if-missing + patch Lead/BGVs/Chorus on sunday_role / saturday_role from a solver history JSON",
    replacement:
      "POST /api/admin/roles (guarded create: target lock + creation receipt + dependency policy) and PATCH /api/admin/roles/[id]",
  },
  "import-setlist-history": {
    file: "scripts/import-setlist-history.mjs",
    did: "create missing featuredSongs / saturdarSongs history documents parsed out of a WhatsApp export",
    replacement: "PUT /api/admin/setlists (guarded, revision-asserted setlist writer)",
  },
  "cleanup-superseded-proposals": {
    file: "scripts/cleanup-superseded-proposals.mjs",
    did: "delete non-approved setlistProposal documents for services that already had an approved proposal",
    replacement:
      "scripts/service-readiness-cleanup.mjs --action resolve-proposal --mode remove (one exact id + revision per invocation, backed up and re-queried)",
  },
  "migrate-shared-proposals": {
    file: "scripts/migrate-shared-proposals.mjs",
    did: "backfill contributors on setlistProposal documents and delete collision losers",
    replacement:
      "already applied in production on 2026-07-03; a residual collision is now handled by scripts/service-readiness-cleanup.mjs --action resolve-proposal",
  },
  "unpublish-july-2026": {
    file: "scripts/unpublish-july-2026.mjs",
    did: "patch published:false on every July 2026 sunday_role / saturday_role / special_role",
    replacement: "POST /api/admin/roles/publish (guarded batch publish/unpublish)",
  },
  "normalize-instrument-names": {
    file: "scripts/normalize-instrument-names.mjs",
    did: "collapse 7 spellings of 5 instruments on role documents to canonical forms",
    replacement: "seatModel.ts provides canonical forms; Task 2 supplies the picklist for the new seat board",
  },
});

export const RETIRED_WRITER_NAMES = Object.freeze(Object.keys(RETIRED_WRITERS).sort());

/**
 * Decide whether a retired writer may run. The answer is always no.
 *
 * `guards` is the shipped `evaluateGuards()` result, so its production refusals
 * are reported verbatim when they apply; `hardFailures` always additionally
 * carries `retired_writer`. An unknown script name is itself a refusal — this
 * gate never guesses which writer it is protecting.
 */
export function evaluateRetiredWriter({ script = null, env = {}, apply = false, unknownFlags = [] } = {}) {
  const entry = typeof script === "string" ? RETIRED_WRITERS[script] : undefined;
  const guards = evaluateGuards({ env, apply, unknownFlags });
  const hardFailures = [...guards.hardFailures];

  if (!entry) {
    hardFailures.push({
      code: "unknown_retired_writer",
      message: `${JSON.stringify(script)} is not a registered retired writer. Refusing rather than guessing.`,
    });
  } else {
    hardFailures.push({
      code: "retired_writer",
      message: `${entry.file} is RETIRED. It used to ${entry.did}. Use instead: ${entry.replacement}.`,
    });
  }

  return {
    script,
    entry: entry ?? null,
    mode: apply ? "apply" : "dry-run",
    projectId: guards.projectId,
    dataset: guards.dataset,
    hardFailures,
    applyBlockers: guards.applyBlockers,
    // Unconditional: there is no path from here to a write, production or not.
    refused: true,
    willContactRemote: false,
    exitCode: 1,
  };
}

/** Pure: the exact lines `assertRetiredWriter` prints. Never prints a secret. */
export function formatRetirementRefusal(decision) {
  const lines = [
    "",
    `RETIRED WRITER — refusing before any Sanity client is constructed.`,
    `  script:   ${decision.entry?.file ?? decision.script ?? "(unknown)"}`,
    `  mode:     ${decision.mode.toUpperCase()} (irrelevant — every mode is refused)`,
    `  project:  ${decision.projectId ?? "(unresolved)"}`,
    `  dataset:  ${decision.dataset ?? "(unresolved)"}`,
  ];
  for (const f of decision.hardFailures) lines.push(`  ✗ [${f.code}] ${f.message}`);
  lines.push("  Nothing was read and nothing was written.", "");
  return lines;
}

/**
 * Call this as the FIRST statement of a retired writer, before any client is
 * built and before any mutation is assembled. It never returns.
 *
 * The JSDoc types are load-bearing: `scripts/import-schedule.ts` imports this
 * `.mjs` module, and `npx tsc --noEmit` infers the parameter types from here.
 *
 * @param {string} script
 * @param {{ argv?: readonly string[]; env?: Record<string, string | undefined> }} [options]
 * @returns {never}
 */
export function assertRetiredWriter(script, { argv = [], env = {} } = {}) {
  const decision = evaluateRetiredWriter({
    script,
    env,
    apply: argv.includes("--apply"),
  });
  for (const line of formatRetirementRefusal(decision)) console.error(line);
  process.exit(decision.exitCode);
}
