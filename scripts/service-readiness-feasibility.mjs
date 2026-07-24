#!/usr/bin/env node
// scripts/service-readiness-feasibility.mjs
//
// The A2 §9 isolated-dataset feasibility gate.
//
//   node scripts/service-readiness-feasibility.mjs           # dry-run: print the plan of checks
//   node scripts/service-readiness-feasibility.mjs --apply   # run them against the isolated dataset
//
// Purpose: before A2 replaces any runtime writer, prove the Content Lake
// accepts (or correctly rejects) every transaction shape A2 §9 lists, and prove
// that after each induced conflict NO partial business state remains.
//
// Dry-run is the default and makes no remote call at all — it prints the
// ordered inventory of checks, what each one induces, and which documents it
// re-queries. The Sanity client module is not imported unless every A3 guard
// passed AND `--apply` was given, so the harness is safe to run today, before
// any token exists.
//
// Each check is a small function (`act(ctx)`) in
// `scripts/lib/sr-feasibility-checks.mjs`. The driver below owns all I/O:
// lease ownership, pre/post snapshots, the no-partial-state comparison, and
// cleanup of the closed set of declared scratch ids.

import {
  TOKEN_ENV,
  evaluateGuards,
  parseCliArgs,
  resolveEnvironment,
} from "./lib/sr-verification.mjs";
import {
  FEASIBILITY_CHECKS,
  assertNoPartialState,
  checkInventory,
  conflictSummary,
  isMutationConflict,
  orderedChecks,
  scratchIds,
} from "./lib/sr-feasibility-checks.mjs";

const SCRIPT = "service-readiness-feasibility";

const args = parseCliArgs(process.argv.slice(2));

if (args.help) {
  console.log(`\n${SCRIPT} — A2 §9 isolated-dataset feasibility gate.\n
  (no flags)  dry-run: print the ordered plan of checks, contact nothing
  --apply     run them against ${"service-readiness-verification"}, guards permitting\n`);
  process.exit(0);
}

const guards = evaluateGuards({ env: process.env, apply: args.apply, unknownFlags: args.unknown });
const ordered = orderedChecks();

console.log(`\n${SCRIPT}`);
console.log(`  mode:      ${guards.mode.toUpperCase()}${args.apply ? "" : " (no remote call will be made)"}`);
console.log(`  project:   ${guards.projectId ?? "(unresolved)"}`);
console.log(`  dataset:   ${guards.dataset ?? "(unresolved)"}`);
console.log(`  token:     ${guards.hasToken ? "present (value never printed)" : `ABSENT (${TOKEN_ENV})`}`);
console.log(`  checks:    ${FEASIBILITY_CHECKS.length} transaction shapes, ${scratchIds().length} declared scratch ids`);

console.log(`\n  Plan (run order resolves every dependsOn first):`);
const inventoryByOrder = new Map(checkInventory(ordered).map((row) => [row.id, row]));
for (const check of ordered) {
  const row = inventoryByOrder.get(check.id);
  console.log(`\n  ${String(row.order).padStart(2, " ")}. ${check.id}  [expects ${check.expects.toUpperCase()}]`);
  console.log(`      ${check.title}`);
  console.log(`      A2 §9: ${check.planRef}`);
  if (check.induces) console.log(`      induces: ${check.induces}`);
  if (row.dependsOn.length) console.log(`      after:   ${row.dependsOn.join(", ")}`);
  if (row.setup.length) console.log(`      setup writes (baselined before the guarded transaction): ${row.setup.join(", ")}`);
  console.log(`      re-query after act (${check.requery.length}):`);
  for (const id of check.requery) console.log(`        · ${id}`);
  if (check.scratch.length) console.log(`      creates: ${check.scratch.join(", ")}`);
}

if (guards.hardFailures.length) {
  console.error("\n  REFUSED — hard guard failure:");
  for (const f of guards.hardFailures) console.error(`    ✗ [${f.code}] ${f.message}`);
}
if (guards.applyBlockers.length) {
  console.error(`\n  ${args.apply ? "REFUSED — missing prerequisites:" : "Cannot --apply yet:"}`);
  for (const f of guards.applyBlockers) console.error(`    · [${f.code}] ${f.message}`);
}

if (guards.refused) {
  console.error("\n  No check was executed.\n");
  process.exit(1);
}

if (!guards.willContactRemote) {
  console.log("\n  DRY-RUN complete. No Sanity client was constructed and no check was executed.");
  console.log("  Re-run with --apply once the verification token and lease identity exist.\n");
  process.exit(0);
}

/* ---------------------------------------------------------------- *
 * Execute — only reachable when guards.willContactRemote === true
 * ---------------------------------------------------------------- */

const { makeVerificationClient, snapshotByIds, ensureMarkerDocument, DatasetLease } = await import(
  "./lib/sr-verification-runtime.mjs"
);

const env = resolveEnvironment(process.env);
const client = makeVerificationClient(guards, process.env[TOKEN_ENV]);
const startedAt = new Date().toISOString();

await ensureMarkerDocument(client, { now: startedAt });

const lease = new DatasetLease(client, {
  runId: env.runId,
  candidateSha: env.candidateSha,
  deploymentId: env.deploymentId,
});
await lease.acquire(startedAt);

/** Assertion failure inside a check — distinct from a Content Lake rejection. */
class CheckAssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckAssertionError";
  }
}

/**
 * Per-check mutable state the driver owns. A check reaches it only through
 * `ctx`, never directly.
 *   requery   the ids of the running check
 *   baseline  the snapshot `ctx.baseline()` captured, or null
 *   evidence  the Content Lake conflicts observed inside `act`
 */
const runState = { requery: [], baseline: null, evidence: [] };

const ctx = {
  client,
  now: () => new Date().toISOString(),
  getDocument: async (id) => {
    const doc = await client.getDocument(id);
    if (!doc) throw new CheckAssertionError(`Expected document ${id} to exist`);
    return doc;
  },
  assert(condition, message) {
    if (!condition) throw new CheckAssertionError(message);
  },
  /**
   * Re-snapshot the re-queried ids as the comparison baseline.
   *
   * A check that must legitimately WRITE before it can induce its conflict (the
   * mid-flight dependency, the first create before a retry, the approval before
   * its replay) calls this once its setup has committed and immediately before
   * the guarded transaction. Without it the baseline would predate the setup,
   * and a deliberate setup write would be misreported as partial state left
   * behind by the rejected transaction.
   */
  async baseline() {
    runState.baseline = await snapshotByIds(client, runState.requery);
    return runState.baseline;
  },
  /**
   * Resolves when `promise` is refused BY A CONTENT LAKE MUTATION CONFLICT.
   * Throws when it unexpectedly succeeds, and equally when it fails for any
   * other reason — an auth error or a dropped connection is not a guard firing
   * and must never be counted as one.
   */
  async expectRejected(promise, message) {
    try {
      await promise;
    } catch (err) {
      if (!isMutationConflict(err)) {
        throw new CheckAssertionError(
          `Rejected, but NOT by a Content Lake mutation conflict (${message}): ${err.message}`,
        );
      }
      runState.evidence.push(conflictSummary(err));
      return;
    }
    throw new CheckAssertionError(`Expected rejection: ${message}`);
  },
  assertExactlyOneFulfilled(results, message) {
    const won = results.filter((r) => r.status === "fulfilled").length;
    if (won !== 1) throw new CheckAssertionError(`${message} (got ${won} winners)`);
    for (const loser of results.filter((r) => r.status === "rejected")) {
      if (!isMutationConflict(loser.reason)) {
        throw new CheckAssertionError(
          `${message} — a loser failed for a non-conflict reason: ${loser.reason?.message ?? loser.reason}`,
        );
      }
      runState.evidence.push(conflictSummary(loser.reason));
    }
  },
  /** Read-only dependency probes, by explicit date / role id. */
  dependenciesForDate: (date) =>
    client.fetch(`*[_type in ["featuredSongs","saturdarSongs","setlistProposal"] && (week == $d || service_date == $d)]._id`, {
      d: date,
    }),
  dependenciesForRole: (roleId) =>
    client.fetch(`*[_type == "setlistProposal" && service_ref._ref == $id]._id`, { id: roleId }),
};

const results = [];
let exitCode = 0;

try {
  for (const check of ordered) {
    // Every check re-proves lease ownership before it touches anything.
    await lease.assertOwned();

    runState.requery = check.requery;
    runState.baseline = null;
    runState.evidence = [];

    const preAct = await snapshotByIds(client, check.requery);
    let outcome;
    let error = null;
    try {
      await check.act(ctx);
      outcome = "commit";
    } catch (err) {
      if (err instanceof CheckAssertionError) {
        results.push({ id: check.id, status: "FAIL", detail: err.message });
        exitCode = 1;
        continue;
      }
      outcome = "reject";
      error = err;
    }
    const after = await snapshotByIds(client, check.requery);

    const setup = check.setup ?? [];
    if (setup.length && runState.baseline === null) {
      // A check that writes before it induces its conflict MUST re-baseline, or
      // its own setup writes would be scored as partial state.
      results.push({
        id: check.id,
        status: "FAIL",
        detail: `harness error: declares ${setup.length} setup id(s) but never called ctx.baseline()${error ? ` (act rejected: ${error.message})` : ""}`,
      });
      exitCode = 1;
      continue;
    }
    // The comparison baseline is the state the GUARDED transaction actually saw.
    const before = runState.baseline ?? preAct;

    if (outcome !== check.expects) {
      results.push({
        id: check.id,
        status: "FAIL",
        detail: `expected act to ${check.expects} but it ${outcome}ed${error ? `: ${error.message}` : ""}`,
      });
      exitCode = 1;
      continue;
    }

    if (outcome === "reject") {
      if (!isMutationConflict(error)) {
        results.push({
          id: check.id,
          status: "FAIL",
          detail: `rejected, but NOT by a Content Lake mutation conflict: ${error.message}`,
        });
        exitCode = 1;
        continue;
      }
      runState.evidence.push(conflictSummary(error));
    }

    // The core proof. `assertNoPartialState` (every re-queried document
    // byte-identical, `_rev` included) is the default for a rejecting check; a
    // check whose conflict has a legitimate winner declares its own `verify`.
    const verify = check.verify ?? (check.expects === "reject" ? assertNoPartialState : null);
    if (verify) {
      const verdict = verify({ before, after });
      if (!verdict.ok) {
        results.push({
          id: check.id,
          status: "FAIL",
          detail: `after-state proof failed: ${verdict.failures.map((f) => `${f.code}@${f.id}`).join(", ")}`,
        });
        exitCode = 1;
        continue;
      }
    }

    results.push({ id: check.id, status: "PASS", detail: null, evidence: runState.evidence.filter(Boolean) });
  }
} catch (err) {
  console.error(`\n  HARNESS FAILED: ${err.message}`);
  exitCode = 1;
} finally {
  // Cleanup runs in `finally` and removes only the declared, closed scratch set.
  try {
    await lease.assertOwned();
    const tx = client.transaction();
    for (const id of scratchIds()) tx.delete(id);
    await tx.commit();
    console.log(`\n  cleanup:   ${scratchIds().length} declared scratch id(s) removed`);
  } catch (err) {
    console.error(`\n  cleanup:   FAILED (${err.message}). Later runs are blocked until an authorized reset.`);
    exitCode = 1;
  }
  await lease.release();
}

console.log("\n  Results:");
for (const r of results) {
  // Rejections print the exact conflict the Content Lake returned, so a PASS
  // carries its own evidence rather than just a tick.
  const evidence = r.evidence?.length ? `  [${r.evidence.join("; ")}]` : "";
  console.log(`    ${r.status === "PASS" ? "✓" : "✗"} ${r.id}${r.detail ? ` — ${r.detail}` : ""}${evidence}`);
}
const passed = results.filter((r) => r.status === "PASS").length;
console.log(`\n  ${passed}/${ordered.length} feasibility checks passed.\n`);

process.exit(exitCode);
