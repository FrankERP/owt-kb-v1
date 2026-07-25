#!/usr/bin/env node
// scripts/service-readiness-restore.mjs
//
// Revision-aware restore of a `service-readiness-cleanup.mjs` backup (plan §8).
//
//   node scripts/service-readiness-restore.mjs --backup <file>                    # dry-run
//   node scripts/service-readiness-restore.mjs --backup <file> \
//        --confirm "restore:<count>:<digest>" --apply                             # writes
//
// The one property that matters here: a restore NEVER force-overwrites. Each
// document is restored under the exact `_rev` the backup recorded, so anything
// written since the backup produces a `later_write_conflict` and the WHOLE
// restore is refused — never a partial, never a "latest wins" merge. A document
// the cleanup deleted is re-created (not an overwrite). `_type` is immutable per
// document id and is never part of a restore patch.
//
// Same guards as the cleanup command: dry-run by default, the production project
// and dataset are hard refusals on either axis, and no Sanity client exists
// until `evaluateGuards(...).willContactRemote === true`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { TOKEN_ENV, evaluateGuards, resolveEnvironment } from "./lib/sr-verification.mjs";
import {
  CLEANUP_TARGET_TYPES,
  evaluateRestore,
  parseCleanupArgs,
  restoreConfirmationPhrase,
  verifyCleanupOutcome,
} from "./lib/sr-cleanup.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "service-readiness-restore";

const args = parseCleanupArgs(process.argv.slice(2));

if (args.help) {
  console.log(`\n${SCRIPT} — restore a cleanup backup, revision-aware.\n`);
  console.log("  --backup <file>   the timestamped envelope written by service-readiness-cleanup");
  console.log("  --confirm <...>   restore:<count>:<digest> (printed by the dry-run)");
  console.log("  --apply           write, if and only if every guard passes and nothing conflicts\n");
  console.log(`  Restorable types: ${CLEANUP_TARGET_TYPES.join(", ")}`);
  console.log("  A later write on ANY document refuses the whole restore. Never force-overwrites.\n");
  process.exit(0);
}

const now = new Date().toISOString();
const guards = evaluateGuards({ env: process.env, apply: args.apply, unknownFlags: args.unknown });

let entries = [];
let envelope = null;
let backupError = null;
if (!args.backupPath) {
  backupError = "--backup <file> is required.";
} else {
  try {
    envelope = JSON.parse(readFileSync(resolve(REPO_ROOT, args.backupPath), "utf8"));
    entries = Array.isArray(envelope?.documents) ? envelope.documents : [];
    if (!entries.length) backupError = "The backup envelope contains no `documents`.";
  } catch (err) {
    backupError = err.message;
  }
}

console.log(`\n${SCRIPT}`);
console.log(`  mode:      ${guards.mode.toUpperCase()}${args.apply ? "" : " (no remote call will be made)"}`);
console.log(`  project:   ${guards.projectId ?? "(unresolved)"}`);
console.log(`  dataset:   ${guards.dataset ?? "(unresolved)"}`);
console.log(`  token:     ${guards.hasToken ? "present (value never printed)" : `ABSENT (${TOKEN_ENV})`}`);
console.log(`  backup:    ${args.backupPath ?? "(none)"}${backupError ? ` — UNUSABLE: ${backupError}` : ""}`);
if (envelope && !backupError) {
  console.log(`  taken:     ${envelope.createdAt ?? "(unknown)"} · kind ${envelope.kind ?? "(unknown)"} · ${entries.length} document(s)`);
  console.log(`  expected --confirm: ${restoreConfirmationPhrase(entries) ?? "(none)"}`);
  for (const e of entries) console.log(`    · ${e?._id ?? "(no id)"} [${e?._type ?? "?"}] @ ${e?._rev ?? "(no revision)"}`);
}

if (guards.hardFailures.length) {
  console.error("\n  REFUSED — hard guard failure:");
  for (const f of guards.hardFailures) console.error(`    ✗ [${f.code}] ${f.message}`);
}
if (guards.applyBlockers.length) {
  console.error(`\n  ${args.apply ? "REFUSED — missing prerequisites:" : "Cannot --apply yet:"}`);
  for (const f of guards.applyBlockers) console.error(`    · [${f.code}] ${f.message}`);
}
if (backupError) console.error(`\n  REFUSED — the backup could not be used.`);

if (guards.refused || backupError) {
  console.error("\n  Nothing was restored.\n");
  process.exit(1);
}

if (!guards.willContactRemote) {
  console.log("\n  DRY-RUN complete. No Sanity client was constructed and no remote call was made.");
  console.log("  With --apply this run would re-read each id above and restore it ONLY under the");
  console.log("  revision recorded in the backup; any later write refuses the whole restore.\n");
  process.exit(0);
}

/* ---------------------------------------------------------------- *
 * Apply — only reachable when guards.willContactRemote === true
 * ---------------------------------------------------------------- */

const { makeVerificationClient, snapshotByIds, writeBackup, ensureMarkerDocument, DatasetLease } = await import(
  "./lib/sr-verification-runtime.mjs"
);

const env = resolveEnvironment(process.env);
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

  const ids = entries.map((e) => e?._id).filter((v) => typeof v === "string" && v.length);
  const before = await snapshotByIds(client, ids);

  const decision = evaluateRestore({ entries, documents: before, confirm: args.confirm });
  console.log(`\n  decision:  ${decision.ok ? "PLAN" : "REFUSED"}`);
  for (const r of decision.refusals) console.error(`    ✗ [${r.code}] ${r.message}`);
  for (const note of decision.plan?.notes ?? []) console.log(`    · ${note}`);

  if (!decision.ok) {
    console.error("\n  REFUSED. Nothing was restored — a restore never force-overwrites.");
    exitCode = 1;
  } else {
    // Back up the CURRENT state before restoring over it, so a restore is itself
    // reversible.
    const pre = ids.map((id) => before[id]).filter(Boolean);
    const prePath = writeBackup({
      repoRoot: REPO_ROOT,
      kind: "pre-restore",
      now,
      projectId: guards.projectId,
      dataset: guards.dataset,
      owner: lease.owner,
      documents: pre,
    });
    console.log(`  backup:    ${pre.length} pre-restore document(s) -> ${prePath}`);

    let tx = client.transaction();
    for (const m of decision.plan.mutations) {
      if (m.op === "createIfNotExists") {
        tx = tx.createIfNotExists({ _id: m.id, _type: m.type, ...m.fields });
        continue;
      }
      if (m.op === "patch") {
        // `_type` is never sent: it is immutable per document id.
        tx = tx.patch(m.id, (p) => p.ifRevisionId(m.rev).set(m.set ?? {}));
        continue;
      }
      throw new Error(`Restore never performs ${m.op}.`);
    }
    await tx.commit();
    console.log(`  committed: ${decision.plan.mutations.length} mutation(s) in ONE transaction`);

    await lease.assertOwned();
    const after = await snapshotByIds(client, ids);
    const verdict = verifyCleanupOutcome({ plan: decision.plan, before, after });
    if (!verdict.ok) {
      console.error("\n  POST-RESTORE VERIFICATION FAILED:");
      for (const f of verdict.failures) console.error(`    ✗ [${f.code}] ${f.id}`);
      exitCode = 1;
    } else {
      console.log("  verified:  every restored document re-queried and present");
    }
  }
} catch (err) {
  console.error(`\n  FAILED: ${err.message}`);
  exitCode = 1;
} finally {
  await lease.release();
}

console.log("");
process.exit(exitCode);
