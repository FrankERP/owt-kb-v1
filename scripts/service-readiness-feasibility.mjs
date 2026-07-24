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
  /** Resolves when `promise` rejects; throws when it unexpectedly succeeds. */
  async expectRejected(promise, message) {
    try {
      await promise;
    } catch {
      return;
    }
    throw new CheckAssertionError(`Expected rejection: ${message}`);
  },
  assertExactlyOneFulfilled(results, message) {
    const won = results.filter((r) => r.status === "fulfilled").length;
    if (won !== 1) throw new CheckAssertionError(`${message} (got ${won} winners)`);
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

    const before = await snapshotByIds(client, check.requery);
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

    if (outcome !== check.expects) {
      results.push({
        id: check.id,
        status: "FAIL",
        detail: `expected ${check.expects} but the transaction ${outcome}ed${error ? `: ${error.message}` : ""}`,
      });
      exitCode = 1;
      continue;
    }

    if (check.expects === "reject") {
      // The core proof: after an induced conflict, every involved document is
      // byte-identical, `_rev` included — no partial business state.
      const verdict = assertNoPartialState({ before, after });
      if (!verdict.ok) {
        results.push({
          id: check.id,
          status: "FAIL",
          detail: `partial state after rejection: ${verdict.failures.map((f) => `${f.code}@${f.id}`).join(", ")}`,
        });
        exitCode = 1;
        continue;
      }
    }

    results.push({ id: check.id, status: "PASS", detail: null });
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
  console.log(`    ${r.status === "PASS" ? "✓" : "✗"} ${r.id}${r.detail ? ` — ${r.detail}` : ""}`);
}
const passed = results.filter((r) => r.status === "PASS").length;
console.log(`\n  ${passed}/${ordered.length} feasibility checks passed.\n`);

process.exit(exitCode);
