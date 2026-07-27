#!/usr/bin/env node
// scripts/service-readiness-verification-seed.mjs
//
// Seed the deterministic synthetic fixtures of the Service Readiness A3
// verification dataset (plan §2).
//
//   node scripts/service-readiness-verification-seed.mjs            # dry-run (default)
//   node scripts/service-readiness-verification-seed.mjs --apply    # writes, guards permitting
//
// DRY-RUN IS THE DEFAULT and makes no remote call whatsoever: the Sanity client
// module is not even imported unless every guard passed AND `--apply` was given.
//
// Guards (all enforced in scripts/lib/sr-verification.mjs):
//   · dry-run default; `--apply` required for any remote write
//   · project must be exactly `scbxomq9`, dataset exactly
//     `service-readiness-verification`; production project `ebb8vcnk` and
//     dataset `production` are hard-refused on either axis, dry-run included
//   · SERVICE_READINESS_VERIFICATION_MARKER must be exactly the documented value
//   · a matching verification marker DOCUMENT must exist (or be bootstrapped)
//   · SR_VERIFY_SANITY_TOKEN must be present; nothing else is ever used
//   · project / dataset / document ids are printed before any apply
//   · fixture ids and `_key`s are deterministic, so reset is repeatable
//   · existing same-id documents are backed up before mutation
//   · the exclusive dataset lease must be held, and is re-checked before writes
//   · after apply the fixtures are re-queried and must match exactly
//
// Required environment for `--apply`:
//   SR_VERIFY_SANITY_PROJECT_ID, SR_VERIFY_SANITY_DATASET,
//   SERVICE_READINESS_VERIFICATION_MARKER, SR_VERIFY_SANITY_TOKEN,
//   SR_VERIFY_ADMIN_PASSWORD_HASH, SR_VERIFY_RUN_ID, SR_VERIFY_CANDIDATE_SHA,
//   SR_VERIFY_DEPLOYMENT_ID

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  ADMIN_HASH_ENV,
  MARKER_DOC_ID,
  MEMBER_HASH_ENV,
  TOKEN_ENV,
  buildFixtureDocuments,
  evaluateGuards,
  parseCliArgs,
  resolveEnvironment,
  verifyFixtureState,
} from "./lib/sr-verification.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "service-readiness-verification-seed";

const args = parseCliArgs(process.argv.slice(2));

if (args.help) {
  console.log(`\n${SCRIPT} — seed the isolated verification dataset.\n
  (no flags)  dry-run: print the exact plan, contact nothing
  --apply     write the fixtures, if and only if every guard passes\n`);
  process.exit(0);
}

const now = new Date().toISOString();
const guards = evaluateGuards({
  env: process.env,
  apply: args.apply,
  unknownFlags: args.unknown,
  requireAdminHash: true,
});

const fixtures = buildFixtureDocuments({ now });

/* ---------------------------------------------------------------- *
 * Plan — always printed, apply or not
 * ---------------------------------------------------------------- */

console.log(`\n${SCRIPT}`);
console.log(`  mode:      ${guards.mode.toUpperCase()}${args.apply ? "" : " (no remote call will be made)"}`);
console.log(`  project:   ${guards.projectId ?? "(unresolved)"}`);
console.log(`  dataset:   ${guards.dataset ?? "(unresolved)"}`);
console.log(`  token:     ${guards.hasToken ? "present (value never printed)" : `ABSENT (${TOKEN_ENV})`}`);
console.log(`  marker:    ${MARKER_DOC_ID}`);

const byType = new Map();
for (const doc of fixtures) byType.set(doc._type, [...(byType.get(doc._type) ?? []), doc._id]);

console.log(`\n  ${fixtures.length} deterministic fixture documents:`);
for (const [type, ids] of [...byType].sort(([a], [b]) => (a < b ? -1 : 1))) {
  console.log(`    ${type} (${ids.length})`);
  for (const id of ids) console.log(`      · ${id}`);
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
  console.error("\n  Nothing was written.\n");
  process.exit(1);
}

if (!guards.willContactRemote) {
  console.log("\n  DRY-RUN complete. No Sanity client was constructed and no remote call was made.");
  console.log("  Re-run with --apply (and the environment above) to seed.\n");
  process.exit(0);
}

/* ---------------------------------------------------------------- *
 * Apply — only reachable when guards.willContactRemote === true
 * ---------------------------------------------------------------- */

const { makeVerificationClient, fetchByIds, writeBackup, ensureMarkerDocument, DatasetLease } = await import(
  "./lib/sr-verification-runtime.mjs"
);

const env = resolveEnvironment(process.env);
const client = makeVerificationClient(guards, process.env[TOKEN_ENV]);
const fixtureIdList = fixtures.map((d) => d._id);

await ensureMarkerDocument(client, { now });

const lease = new DatasetLease(client, {
  runId: env.runId,
  candidateSha: env.candidateSha,
  deploymentId: env.deploymentId,
});
await lease.acquire(now);

let exitCode = 0;
try {
  // Re-read the lease and confirm the exact owner before touching a fixture.
  await lease.assertOwned();

  // Back up every EXISTING same-id document before it is replaced.
  const existing = await fetchByIds(client, fixtureIdList);
  const backupPath = writeBackup({
    repoRoot: REPO_ROOT,
    kind: "seed",
    now,
    projectId: guards.projectId,
    dataset: guards.dataset,
    owner: lease.owner,
    documents: existing,
  });
  console.log(`  backup:    ${existing.length} existing document(s) -> ${backupPath}`);

  // Inject the synthetic credential hashes at apply time only. They are supplied
  // by the environment, never committed, and never printed.
  //
  // The member hash exists because A3 §4 must prove that a *member* caller is
  // rejected by the admin routes, which requires a member who can actually sign
  // in. Without it the harness has an admin and nothing to contrast it against.
  // It is optional: when unset, member fixtures are seeded without a password
  // exactly as before, and only the member-authorization scenario is unavailable.
  const adminHash = process.env[ADMIN_HASH_ENV];
  const memberHash = process.env[MEMBER_HASH_ENV];
  const toWrite = fixtures.map((doc) => {
    if (doc._id === "srv.member.admin") return { ...doc, passwordHash: adminHash };
    if (doc._id === "srv.member.lead" && memberHash) return { ...doc, passwordHash: memberHash };
    return doc;
  });

  const tx = client.transaction();
  for (const doc of toWrite) tx.createOrReplace(doc);
  await tx.commit();
  console.log(`  wrote:     ${toWrite.length} fixture document(s)`);

  // Post-apply exactness: re-query and demand the expected state.
  await lease.assertOwned();
  const actual = await fetchByIds(client, fixtureIdList);
  const verdict = verifyFixtureState({ expected: fixtures, actual });
  if (!verdict.ok) {
    console.error("\n  POST-APPLY VERIFICATION FAILED:");
    for (const f of verdict.failures) console.error(`    ✗ [${f.code}] ${f.id ?? ""}`);
    exitCode = 1;
  } else {
    console.log(`  verified:  ${actual.length}/${fixtures.length} fixtures match exactly`);
  }
} catch (err) {
  console.error(`\n  FAILED: ${err.message}`);
  exitCode = 1;
} finally {
  await lease.release();
}

console.log("");
process.exit(exitCode);
