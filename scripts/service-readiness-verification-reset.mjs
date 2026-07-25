#!/usr/bin/env node
// scripts/service-readiness-verification-reset.mjs
//
// Remove the deterministic synthetic fixtures (and the feasibility harness's
// declared scratch documents) from the Service Readiness A3 verification
// dataset (plan §2).
//
//   node scripts/service-readiness-verification-reset.mjs           # dry-run (default)
//   node scripts/service-readiness-verification-reset.mjs --apply   # deletes, guards permitting
//
// Deletion is allowlist-only: the exact deterministic fixture ids from
// `buildFixtureDocuments()` plus the exact declared scratch ids from
// `FEASIBILITY_CHECKS`. There is NO discovery query, NO `*[_type == ...]`
// deletion, and no pattern match — an id that is not on the closed list is
// reported and skipped. The verification marker and the dataset lease are never
// deletion targets.
//
// Same guards as the seed script; see its header.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  INFRASTRUCTURE_IDS,
  RUN_OWNED_LOGIN_EVENT_QUERY,
  TOKEN_ENV,
  evaluateGuards,
  filterDeletableIds,
  fixtureIds,
  parseCliArgs,
  resolveEnvironment,
  runOwnedLoginEventParams,
  verifyResetState,
} from "./lib/sr-verification.mjs";
import { scratchIds } from "./lib/sr-feasibility-checks.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "service-readiness-verification-reset";

const args = parseCliArgs(process.argv.slice(2));

if (args.help) {
  console.log(`\n${SCRIPT} — delete the isolated verification fixtures.\n
  (no flags)  dry-run: print the exact id list, contact nothing
  --apply     delete those exact ids, if and only if every guard passes\n`);
  process.exit(0);
}

const now = new Date().toISOString();
const guards = evaluateGuards({ env: process.env, apply: args.apply, unknownFlags: args.unknown });

// The closed deletion allowlist. Built from the deterministic generators, never
// from a query against the dataset.
const fixtureTargets = fixtureIds();
const scratchTargets = scratchIds();
const { allowed: allowedFixtures, refused: refusedFixtures } = filterDeletableIds(fixtureTargets);
const targets = [...allowedFixtures, ...scratchTargets];

console.log(`\n${SCRIPT}`);
console.log(`  mode:      ${guards.mode.toUpperCase()}${args.apply ? "" : " (no remote call will be made)"}`);
console.log(`  project:   ${guards.projectId ?? "(unresolved)"}`);
console.log(`  dataset:   ${guards.dataset ?? "(unresolved)"}`);
console.log(`  token:     ${guards.hasToken ? "present (value never printed)" : `ABSENT (${TOKEN_ENV})`}`);
console.log(`  protected: ${INFRASTRUCTURE_IDS.join(", ")} (never deleted)`);

console.log(`\n  ${targets.length} deterministic deletion targets (allowlist only, no discovery query):`);
console.log(`    fixtures (${allowedFixtures.length}):`);
for (const id of allowedFixtures) console.log(`      · ${id}`);
console.log(`    feasibility scratch (${scratchTargets.length}):`);
for (const id of scratchTargets) console.log(`      · ${id}`);
if (refusedFixtures.length) {
  console.error(`\n  ✗ ${refusedFixtures.length} generated id(s) failed the allowlist and will NOT be deleted:`);
  for (const id of refusedFixtures) console.error(`      · ${id}`);
}

// Run-owned credentials login events (plan §4). These are the ONE category whose
// ids are not deterministic — `auth.ts` creates them with a random id — so they
// are discovered through the exact run + deployment ownership predicate and then
// deleted by explicit `_id` only. There is no broad `*[_type == "loginEvent"]`
// path, no email/member path and no timestamp-range path.
const runIdentity = resolveEnvironment(process.env);
const loginEventParams = runOwnedLoginEventParams(runIdentity);
console.log(`\n  run-owned login events (discovered by exact predicate, deleted by exact _id):`);
console.log(`    predicate: ${RUN_OWNED_LOGIN_EVENT_QUERY}`);
console.log(
  loginEventParams
    ? `    params:    runId=${loginEventParams.runId} deploymentId=${loginEventParams.deploymentId}`
    : `    params:    (run identity unresolved — set SR_VERIFY_RUN_ID / SR_VERIFY_CANDIDATE_SHA / SR_VERIFY_DEPLOYMENT_ID)`,
);

if (guards.hardFailures.length) {
  console.error("\n  REFUSED — hard guard failure:");
  for (const f of guards.hardFailures) console.error(`    ✗ [${f.code}] ${f.message}`);
}
if (guards.applyBlockers.length) {
  console.error(`\n  ${args.apply ? "REFUSED — missing prerequisites:" : "Cannot --apply yet:"}`);
  for (const f of guards.applyBlockers) console.error(`    · [${f.code}] ${f.message}`);
}

if (guards.refused) {
  console.error("\n  Nothing was deleted.\n");
  process.exit(1);
}

if (!guards.willContactRemote) {
  console.log("\n  DRY-RUN complete. No Sanity client was constructed and no remote call was made.");
  console.log("  Re-run with --apply (and the environment above) to reset.\n");
  process.exit(0);
}

/* ---------------------------------------------------------------- *
 * Apply — only reachable when guards.willContactRemote === true
 * ---------------------------------------------------------------- */

const {
  makeVerificationClient,
  fetchByIds,
  writeBackup,
  ensureMarkerDocument,
  DatasetLease,
  fetchRunOwnedLoginEvents,
  deleteRunOwnedLoginEvents,
  verifyRunOwnedLoginEventsGone,
} = await import(
  "./lib/sr-verification-runtime.mjs"
);

const env = runIdentity;
const client = makeVerificationClient(guards, process.env[TOKEN_ENV]);

await ensureMarkerDocument(client, { now });

const lease = new DatasetLease(client, {
  runId: env.runId,
  candidateSha: env.candidateSha,
  deploymentId: env.deploymentId,
});
await lease.acquire(now);

let exitCode = 0;
try {
  await lease.assertOwned();

  // Back up everything that actually exists among the allowlisted ids, before
  // any of it is removed.
  const existing = await fetchByIds(client, targets);
  const backupPath = writeBackup({
    repoRoot: REPO_ROOT,
    kind: "reset",
    now,
    projectId: guards.projectId,
    dataset: guards.dataset,
    owner: lease.owner,
    documents: existing,
  });
  console.log(`  backup:    ${existing.length} existing document(s) -> ${backupPath}`);

  const tx = client.transaction();
  for (const id of targets) tx.delete(id);
  await tx.commit();
  console.log(`  deleted:   ${targets.length} allowlisted id(s)`);

  // Run-owned login events, still under the same live lease. Discovered by the
  // exact ownership predicate, validated against the FULL ownership tuple, then
  // deleted by explicit `_id` under each document's revision. Re-queried
  // afterwards and required to be empty.
  await lease.assertOwned();
  const loginIdentity = {
    runId: env.runId,
    candidateSha: env.candidateSha,
    deploymentId: env.deploymentId,
  };
  const ownedLoginEvents = await fetchRunOwnedLoginEvents(client, loginIdentity);
  console.log(`  logins:    ${ownedLoginEvents.length} run-owned login event(s) matched the exact predicate`);
  if (ownedLoginEvents.length) {
    const loginBackup = writeBackup({
      repoRoot: REPO_ROOT,
      kind: "reset-login-events",
      now,
      projectId: guards.projectId,
      dataset: guards.dataset,
      owner: lease.owner,
      documents: ownedLoginEvents,
    });
    console.log(`  backup:    run-owned login events -> ${loginBackup}`);
  }
  const { deletedIds, refused: refusedLoginEvents } = await deleteRunOwnedLoginEvents(
    client,
    ownedLoginEvents,
    loginIdentity,
  );
  for (const id of deletedIds) console.log(`      · deleted ${id}`);
  if (refusedLoginEvents.length) {
    console.error(`\n  ✗ ${refusedLoginEvents.length} matched login event(s) failed full-tuple validation and were NOT deleted:`);
    for (const r of refusedLoginEvents) console.error(`      · ${r.id ?? "(no id)"} [${r.reason}]`);
    exitCode = 1;
  }
  const loginCleanup = await verifyRunOwnedLoginEventsGone(client, loginIdentity);
  if (!loginCleanup.verdict.ok) {
    console.error("\n  RUN-OWNED LOGIN EVENT CLEANUP FAILED:");
    for (const f of loginCleanup.verdict.failures) console.error(`    ✗ [${f.code}] ${f.id}`);
    exitCode = 1;
  } else {
    console.log("  verified:  zero run-owned login events remain");
  }

  await lease.assertOwned();
  const remaining = await fetchByIds(client, targets);
  const verdict = verifyResetState({ remaining });
  const scratchLeft = remaining.filter((d) => scratchTargets.includes(d._id));
  if (!verdict.ok || scratchLeft.length) {
    console.error("\n  POST-RESET VERIFICATION FAILED:");
    for (const f of verdict.failures) console.error(`    ✗ [${f.code}] ${f.id}`);
    for (const d of scratchLeft) console.error(`    ✗ [scratch_not_removed] ${d._id}`);
    exitCode = 1;
  } else {
    console.log("  verified:  zero fixture or scratch documents remain");
  }
} catch (err) {
  console.error(`\n  FAILED: ${err.message}`);
  exitCode = 1;
} finally {
  await lease.release();
}

console.log("");
process.exit(exitCode);
