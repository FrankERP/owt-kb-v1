#!/usr/bin/env node
// scripts/service-readiness-cleanup.mjs
//
// Guarded operator cleanup for the Service Readiness protected types
// (plan §8 of docs/superpowers/plans/2026-07-18-service-readiness-mutation-integrity.md).
//
//   node scripts/service-readiness-cleanup.mjs --help
//   node scripts/service-readiness-cleanup.mjs --action <a> --id <id> --rev <rev> \
//        [--mode <m>] [--evidence intent.json]                     # dry-run (default)
//   ... --confirm "<action>[#mode]:<id>@<rev>" --apply              # writes, guards permitting
//
// Properties, all enforced rather than documented:
//   · DRY-RUN BY DEFAULT. No Sanity client is even constructed unless
//     `evaluateGuards(...).willContactRemote === true`, which needs `--apply`.
//   · The PRODUCTION project (`ebb8vcnk`) and dataset (`production`) are hard
//     refusals on either axis, in dry-run too. A production cleanup needs
//     separate explicit user consent and is not this command.
//   · Exact ids AND revisions only. Every mutation carries the revision this run
//     observed; `delete` (which takes no precondition) is always paired with a
//     revision-asserting patch in the SAME transaction.
//   · Action-specific confirmation: `--confirm` must name the action, the exact
//     id and the exact revision, so a phrase cannot be recycled.
//   · A timestamped pre-mutation backup is written to the gitignored backup
//     directory BEFORE anything is touched, and `service-readiness-restore.mjs`
//     restores it revision-aware.
//   · Every document the plan touches is RE-QUERIED afterwards and verified.
//   · ONE target per invocation. Multi-target cleanup is separate invocations.
//
// All decisions come from `lib/sr-cleanup.mjs` (pure, unit-tested); all guards
// from `lib/sr-verification.mjs`. This file is I/O only.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  TOKEN_ENV,
  evaluateGuards,
  resolveEnvironment,
} from "./lib/sr-verification.mjs";
import {
  CLEANUP_ACTIONS,
  CLEANUP_ACTION_NAMES,
  CLEANUP_TARGET_TYPES,
  confirmationPhrase,
  evaluateCleanupAction,
  parseCleanupArgs,
  publishedIdOf,
  roleServiceDate,
  verifyCleanupOutcome,
} from "./lib/sr-cleanup.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "service-readiness-cleanup";

const args = parseCleanupArgs(process.argv.slice(2));

if (args.help) {
  console.log(`\n${SCRIPT} — guarded, dry-run-by-default operator cleanup.\n`);
  console.log("  Required: --action <name> --id <exact id> --rev <exact revision>");
  console.log("  Also:     --mode <mode> (where the action takes one), --evidence <intent.json>");
  console.log("  To write: --confirm \"<action>[#mode]:<id>@<rev>\" --apply\n");
  console.log("  Actions:");
  for (const name of CLEANUP_ACTION_NAMES) {
    const spec = CLEANUP_ACTIONS[name];
    console.log(`    · ${name}${spec.modes ? ` (--mode ${spec.modes.join("|")})` : ""}`);
    console.log(`        ${spec.summary}`);
    console.log(`        types: ${spec.types.join(", ")}`);
  }
  console.log(`\n  Protected types: ${CLEANUP_TARGET_TYPES.join(", ")}`);
  console.log("  Never targets the production project/dataset. One target per invocation.\n");
  process.exit(0);
}

const now = new Date().toISOString();
const guards = evaluateGuards({ env: process.env, apply: args.apply, unknownFlags: args.unknown });

/* ---------------------------------------------------------------- *
 * Operator intent file (local read only — never a proof of dataset state)
 * ---------------------------------------------------------------- */

let intent = {};
let intentError = null;
if (args.evidencePath) {
  try {
    intent = JSON.parse(readFileSync(resolve(REPO_ROOT, args.evidencePath), "utf8"));
  } catch (err) {
    intentError = err.message;
  }
}

console.log(`\n${SCRIPT}`);
console.log(`  mode:      ${guards.mode.toUpperCase()}${args.apply ? "" : " (no remote call will be made)"}`);
console.log(`  project:   ${guards.projectId ?? "(unresolved)"}`);
console.log(`  dataset:   ${guards.dataset ?? "(unresolved)"}`);
console.log(`  token:     ${guards.hasToken ? "present (value never printed)" : `ABSENT (${TOKEN_ENV})`}`);
console.log(`  action:    ${args.action ?? "(none)"}${args.mode ? ` --mode ${args.mode}` : ""}`);
console.log(`  target:    ${args.id ?? "(none)"} @ ${args.rev ?? "(no revision)"}`);
console.log(`  confirm:   ${args.confirm ? "supplied" : "ABSENT"} (expected: ${confirmationPhrase({ action: args.action, id: args.id, rev: args.rev, mode: args.mode }) ?? "<action>[#mode]:<id>@<rev>"})`);
console.log(`  intent:    ${args.evidencePath ?? "(none)"}${intentError ? ` — UNREADABLE: ${intentError}` : ""}`);

if (guards.hardFailures.length) {
  console.error("\n  REFUSED — hard guard failure:");
  for (const f of guards.hardFailures) console.error(`    ✗ [${f.code}] ${f.message}`);
}
if (guards.applyBlockers.length) {
  console.error(`\n  ${args.apply ? "REFUSED — missing prerequisites:" : "Cannot --apply yet:"}`);
  for (const f of guards.applyBlockers) console.error(`    · [${f.code}] ${f.message}`);
}
if (intentError) {
  console.error(`\n  REFUSED — --evidence ${args.evidencePath} could not be read.`);
}

if (guards.refused || intentError) {
  console.error("\n  Nothing was written.\n");
  process.exit(1);
}

/* ---------------------------------------------------------------- *
 * Dry-run
 *
 * An offline dry-run cannot observe the dataset, so the DECISION is only
 * rehearsed when the intent file carries an `observed` snapshot (an
 * `{ id: document }` map, e.g. copied out of an earlier backup envelope) plus
 * the evidence arrays. Otherwise the CLI/guards are validated and the exact
 * queries this run WOULD issue are printed. Either way nothing is contacted.
 * ---------------------------------------------------------------- */

if (!guards.willContactRemote) {
  const observed = isObj(intent.observed) ? intent.observed : null;
  let rehearsalRefused = false;
  if (observed) {
    const decision = evaluateCleanupAction({
      action: args.action,
      id: args.id,
      rev: args.rev,
      mode: args.mode,
      confirm: args.confirm,
      documents: observed,
      evidence: intent.evidence ?? {},
      now,
    });
    printDecision(decision);
    rehearsalRefused = !decision.ok;
  } else {
    console.log("\n  No `observed` snapshot in the intent file, so no decision is rehearsed offline.");
    console.log("  With --apply this run would, in order:");
    console.log("    1. acquire the exclusive dataset lease");
    console.log(`    2. re-read the exact target ${args.id ?? "(none)"} and its related documents`);
    console.log("    3. gather its own dependency/orphan proof with explicit GROQ queries");
    console.log("    4. write a timestamped backup outside tracked files");
    console.log("    5. commit ONE transaction (revision-asserted), then re-query and verify");
  }
  console.log("\n  DRY-RUN complete. No Sanity client was constructed and no remote call was made.");
  console.log("  Re-run with --apply (and the verification environment above) to act.\n");
  // A rehearsed decision that the pure logic REFUSES exits non-zero, so a dry-run
  // is a usable pre-flight check and not just a print.
  process.exit(rehearsalRefused ? 1 : 0);
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

  // ── Observe: the exact target plus every id the intent names ──────────
  const seedIds = unique([
    args.id,
    publishedIdOf(args.id ?? ""),
    intent.evidence?.keepId,
    intent.evidence?.lockId,
    intent.evidence?.serviceRef,
  ]);
  let observed = await snapshotByIds(client, seedIds);
  const target = observed[args.id] ?? null;
  // A role's internal receipt link is only known after the target is read.
  const receiptId = target && typeof target.creationReceiptId === "string" ? target.creationReceiptId : null;
  if (receiptId && !(receiptId in observed)) {
    observed = { ...observed, ...(await snapshotByIds(client, [receiptId])) };
  }

  // ── Prove: this run gathers its OWN evidence, never trusting the file ──
  const evidence = { ...(intent.evidence ?? {}), ...(await gatherEvidence(client, args, target)) };

  const decision = evaluateCleanupAction({
    action: args.action,
    id: args.id,
    rev: args.rev,
    mode: args.mode,
    confirm: args.confirm,
    documents: observed,
    evidence,
    now,
  });
  printDecision(decision);

  if (!decision.ok) {
    console.error("\n  REFUSED. Nothing was written.");
    exitCode = 1;
  } else {
    await lease.assertOwned();

    const before = await snapshotByIds(client, unique(decision.plan.requeryIds));
    const backupDocs = unique(decision.plan.backupIds)
      .map((id) => before[id])
      .filter(Boolean);
    const backupPath = writeBackup({
      repoRoot: REPO_ROOT,
      kind: `cleanup-${decision.plan.kind.replace(/[^a-z0-9]+/gi, "-")}`,
      now,
      projectId: guards.projectId,
      dataset: guards.dataset,
      owner: lease.owner,
      documents: backupDocs,
    });
    console.log(`  backup:    ${backupDocs.length} document(s) -> ${backupPath}`);

    if (!decision.plan.mutations.length) {
      console.log("  inspect:   read-only action — nothing to commit.");
    } else {
      await commitPlan(client, decision.plan);
      console.log(`  committed: ${decision.plan.mutations.length} mutation(s) in ONE transaction`);

      await lease.assertOwned();
      const after = await snapshotByIds(client, unique(decision.plan.requeryIds));
      const verdict = verifyCleanupOutcome({ plan: decision.plan, before, after });
      if (!verdict.ok) {
        console.error("\n  POST-WRITE VERIFICATION FAILED:");
        for (const f of verdict.failures) console.error(`    ✗ [${f.code}] ${f.id}`);
        console.error(`    Restore with: node scripts/service-readiness-restore.mjs --backup ${backupPath}`);
        exitCode = 1;
      } else {
        console.log("  verified:  re-queried every touched document; state matches the plan");
      }
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

/* ---------------------------------------------------------------- *
 * Helpers
 * ---------------------------------------------------------------- */

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function unique(ids) {
  return [...new Set(ids.filter((v) => typeof v === "string" && v.length))];
}

function printDecision(decision) {
  console.log(`\n  decision:  ${decision.ok ? "PLAN" : "REFUSED"}`);
  for (const r of decision.refusals) console.error(`    ✗ [${r.code}] ${r.message}`);
  if (!decision.plan) return;
  for (const note of decision.plan.notes) console.log(`    · ${note}`);
  console.log(`    backup:  ${decision.plan.backupIds.join(", ") || "(none)"}`);
  console.log(`    requery: ${decision.plan.requeryIds.join(", ")}`);
  console.log(`    mutations (${decision.plan.mutations.length}), one transaction:`);
  for (const m of decision.plan.mutations) {
    const detail =
      m.op === "patch"
        ? ` set=${JSON.stringify(m.set ?? {})} unset=${JSON.stringify(m.unset ?? [])}`
        : m.op === "createIfNotExists"
          ? ` type=${m.type}`
          : "";
    console.log(`      ${m.op} ${m.id}${m.rev ? ` @${m.rev}` : ""}${detail}`);
  }
}

/**
 * Gather the proof each action needs, with explicit GROQ over the protected
 * types. The operator supplies INTENT (which document to keep, which fields to
 * repair); the dataset supplies PROOF. Nothing here trusts the intent file for a
 * dependency, orphan, or liveness claim.
 */
async function gatherEvidence(client, cli, target) {
  if (!target) return {};
  const evidence = {};

  if (cli.action === "remove-malformed-role") {
    const date = roleServiceDate(target);
    evidence.canonicalSetlists = await client.fetch(
      `*[_type in ["featuredSongs", "saturdarSongs"] && string(week) == $date]{ _id, _type, "week": string(week), songs }`,
      { date: date ?? "" },
    );
    evidence.rawSetlistDrafts = await client.fetch(
      `*[_id in path("drafts.**") && _type in ["featuredSongs", "saturdarSongs"] && string(week) == $date]{ _id, _type, "week": string(week), songs }`,
      { date: date ?? "" },
    );
    const proposalProjection = `{ _id, _type, service_type, "service_date": string(service_date), "service_ref": service_ref._ref, status }`;
    evidence.canonicalProposals = await client.fetch(
      `*[_type == "setlistProposal" && (service_ref._ref == $roleId || string(service_date) == $date)]${proposalProjection}`,
      { roleId: target._id, date: date ?? "" },
    );
    evidence.rawProposalDrafts = await client.fetch(
      `*[_id in path("drafts.**") && _type == "setlistProposal" && (service_ref._ref == $roleId || string(service_date) == $date)]${proposalProjection}`,
      { roleId: target._id, date: date ?? "" },
    );
    evidence.unknownReferences = await client.fetch(`*[references($roleId)]{ _id, _type }`, { roleId: target._id });
  }

  if (cli.action === "remove-orphan-setlist") {
    const week = typeof target.week === "string" ? target.week.slice(0, 10) : "";
    const ownerType = target._type === "featuredSongs" ? "sunday_role" : "saturday_role";
    evidence.canonicalOwners = await client.fetch(
      `*[_type == $ownerType && string(week) == $week]{ _id, _type, "week": string(week) }`,
      { ownerType, week },
    );
    evidence.rawOwnerDrafts = await client.fetch(
      `*[_id in path("drafts.**") && _type == $ownerType && string(week) == $week]{ _id, _type, "week": string(week) }`,
      { ownerType, week },
    );
    evidence.observedSetlists = await client.fetch(
      `*[_type == $type && string(week) == $week]{ _id, _type, "week": string(week), songs }`,
      { type: target._type, week },
    );
  }

  if (cli.action === "vacate-orphan-lock") {
    const ownerId = typeof target.roleId === "string" ? target.roleId : "";
    evidence.publishedRoles = await client.fetch(
      `*[_type in ["sunday_role", "saturday_role", "special_role"] && _id == $ownerId]{ _id, _type }`,
      { ownerId },
    );
    evidence.rawRoleDrafts = await client.fetch(
      `*[_id in path("drafts.**") && _type in ["sunday_role", "saturday_role", "special_role"] && _id == $draftId]{ _id, _type }`,
      { draftId: `drafts.${ownerId}` },
    );
  }

  if (cli.action === "cleanup-creation-receipt") {
    evidence.liveRoles = await client.fetch(
      `*[_type in ["sunday_role", "saturday_role", "special_role"] && (creationReceiptId == $receiptId || _id == $roleId)]{ _id, _type, creationReceiptId }`,
      { receiptId: target._id, roleId: typeof target.roleId === "string" ? target.roleId : "" },
    );
  }

  if (cli.action === "resolve-proposal" && cli.mode === "retarget") {
    evidence.destinationProposals = await client.fetch(
      `*[_type == "setlistProposal" && service_ref._ref == $ref]{ _id, _type, service_type, "service_date": string(service_date), "service_ref": service_ref._ref, status }`,
      { ref: intent.evidence?.serviceRef ?? "" },
    );
  }

  return evidence;
}

/**
 * Execute one plan as a SINGLE transaction.
 *
 * `assertRev` becomes a content-neutral revision-asserting patch: `delete` takes
 * no precondition of its own, so the `ifRevisionId` on a same-transaction patch
 * is what makes the delete revision-exact. It unsets a field that never exists,
 * so no business content is written — including on a document (like a duplicate
 * keeper) that is asserted but deliberately never modified.
 */
async function commitPlan(client, plan) {
  let tx = client.transaction();
  for (const m of plan.mutations) {
    if (m.op === "assertRev") {
      tx = tx.patch(m.id, (p) => p.ifRevisionId(m.rev).unset(["srCleanupAssertion"]));
      continue;
    }
    if (m.op === "delete") {
      tx = tx.delete(m.id);
      continue;
    }
    if (m.op === "patch") {
      tx = tx.patch(m.id, (p) => {
        let out = p.ifRevisionId(m.rev);
        if (m.set) out = out.set(m.set);
        if (m.unset) out = out.unset(m.unset);
        if (m.inc) out = out.inc(m.inc);
        return out;
      });
      continue;
    }
    if (m.op === "createIfNotExists") {
      tx = tx.createIfNotExists({ _id: m.id, _type: m.type, ...m.fields });
      continue;
    }
    throw new Error(`Unknown mutation op ${m.op} — refusing to guess.`);
  }
  return tx.commit();
}
