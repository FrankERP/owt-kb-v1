// scripts/lib/sr-verification-runtime.mjs
//
// The I/O half of the A3 verification tooling: printing, client construction,
// the exclusive dataset lease, and backup files.
//
// Every DECISION comes from `sr-verification.mjs` (pure, unit-tested). This
// module only executes decisions, and it can only be reached after
// `evaluateGuards(...).willContactRemote === true` — which requires `--apply`
// plus a clean environment. Nothing here is imported on a dry-run path.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@sanity/client";

import {
  DEFAULT_LEASE_TTL_MS,
  LEASE_DOC_ID,
  MARKER_DOC_ID,
  backupFileName,
  buildBackupEnvelope,
  buildLeaseDocument,
  buildMarkerDocument,
  evaluateLeaseClaim,
  evaluateLeaseOwnership,
  evaluateLeaseRelease,
  evaluateLeaseRenewal,
  evaluateMarkerDocument,
  leaseOwner,
} from "./sr-verification.mjs";

/* ------------------------------------------------------------------ *
 * Printing — never prints a secret VALUE, only presence
 * ------------------------------------------------------------------ */

export function printHeader(scriptName, guards) {
  console.log(`\n${scriptName}`);
  console.log(`  mode:      ${guards.mode.toUpperCase()}${guards.mode === "dry-run" ? " (no remote call will be made)" : ""}`);
  console.log(`  project:   ${guards.projectId ?? "(unresolved)"}`);
  console.log(`  dataset:   ${guards.dataset ?? "(unresolved)"}`);
  console.log(`  token:     ${guards.hasToken ? "present (value never printed)" : "ABSENT"}`);
}

export function printGuardResults(guards) {
  if (guards.hardFailures.length) {
    console.error("\n  REFUSED — hard guard failure:");
    for (const f of guards.hardFailures) console.error(`    ✗ [${f.code}] ${f.message}`);
  }
  if (guards.applyBlockers.length) {
    const label = guards.mode === "apply" ? "REFUSED — missing prerequisites:" : "Cannot --apply yet:";
    console.error(`\n  ${label}`);
    for (const f of guards.applyBlockers) console.error(`    · [${f.code}] ${f.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

/**
 * Build a Sanity client. Callers MUST have proven
 * `guards.willContactRemote === true` first; this throws otherwise, so a future
 * edit cannot reach the network by forgetting a branch.
 */
export function makeVerificationClient(guards, token) {
  if (!guards.willContactRemote) {
    throw new Error("Refusing to build a Sanity client: guards did not authorize remote contact.");
  }
  return createClient({
    projectId: guards.projectId,
    dataset: guards.dataset,
    apiVersion: guards.apiVersion,
    token,
    useCdn: false,
  });
}

/** Fetch documents by an explicit id list. Never a broad type query. */
export async function fetchByIds(client, ids) {
  if (!ids.length) return [];
  return client.fetch(`*[_id in $ids]`, { ids });
}

/** Fetch documents by explicit id list, keyed by id, with `null` for absentees. */
export async function snapshotByIds(client, ids) {
  const docs = await fetchByIds(client, ids);
  const byId = new Map(docs.map((d) => [d._id, d]));
  const out = {};
  for (const id of ids) out[id] = byId.get(id) ?? null;
  return out;
}

/* ------------------------------------------------------------------ *
 * Backups
 * ------------------------------------------------------------------ */

/**
 * Write a pre-mutation backup of the supplied documents into the gitignored
 * backup directory. Returns the absolute path.
 */
export function writeBackup({ repoRoot, kind, now, projectId, dataset, owner, documents }) {
  const relative = backupFileName({ kind, now });
  const absolute = resolve(repoRoot, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(
    absolute,
    `${JSON.stringify(buildBackupEnvelope({ kind, now, projectId, dataset, owner, documents }), null, 2)}\n`,
    "utf8",
  );
  return absolute;
}

/* ------------------------------------------------------------------ *
 * Verification marker document
 * ------------------------------------------------------------------ */

/**
 * Prove the dataset is the verification dataset, bootstrapping the marker
 * document when absent. A marker document with a different value is fatal.
 */
export async function ensureMarkerDocument(client, { now }) {
  const existing = await client.getDocument(MARKER_DOC_ID).catch(() => null);
  const decision = evaluateMarkerDocument(existing ?? null);
  if (decision.action === "refuse") {
    throw new Error(`Verification marker document ${MARKER_DOC_ID} does not match the expected value. Refusing.`);
  }
  if (decision.action === "create") {
    await client.createIfNotExists(buildMarkerDocument({ now }));
    console.log(`  marker:    ${MARKER_DOC_ID} created`);
    return;
  }
  console.log(`  marker:    ${MARKER_DOC_ID} verified`);
}

/* ------------------------------------------------------------------ *
 * Exclusive dataset lease
 * ------------------------------------------------------------------ */

export class LeaseError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "LeaseError";
    this.reason = reason;
  }
}

/**
 * Owns the `serviceReadiness.verificationLease` document for one run.
 *
 * Acquire: create-if-absent, or replace an expired lease under its `_rev`.
 * A live foreign lease fails immediately — never stolen, never deleted.
 * Every fixture mutation calls `assertOwned()` first, which RE-READS the lease
 * and compares the exact owner. Release is owner-only, under `_rev`.
 */
export class DatasetLease {
  constructor(client, { runId, candidateSha, deploymentId, ttlMs = DEFAULT_LEASE_TTL_MS }) {
    this.client = client;
    this.identity = { runId, candidateSha, deploymentId };
    this.owner = leaseOwner(this.identity);
    this.ttlMs = ttlMs;
    this.held = false;
    if (!this.owner) {
      throw new LeaseError(
        "invalid_owner",
        "Lease owner requires SR_VERIFY_RUN_ID, SR_VERIFY_CANDIDATE_SHA and SR_VERIFY_DEPLOYMENT_ID (no ':' allowed).",
      );
    }
  }

  async read() {
    return this.client.getDocument(LEASE_DOC_ID).catch(() => null);
  }

  async acquire(now = new Date().toISOString()) {
    const existing = await this.read();
    const decision = evaluateLeaseClaim({ existing, owner: this.owner, now });

    if (decision.action === "refuse") {
      throw new LeaseError(
        decision.reason,
        decision.reason === "foreign_live_lease"
          ? `Dataset lease is held by another run until ${existing?.expiresAt}. Refusing — a live lease is never stolen.`
          : `Dataset lease is unusable (${decision.reason}). An explicitly authorized targeted reset is required.`,
      );
    }

    const doc = buildLeaseDocument({ owner: this.owner, ...this.identity, now, ttlMs: this.ttlMs });

    if (decision.action === "create") {
      // `create` is the atomic acquire: a concurrent winner makes this throw.
      await this.client.create(doc);
    } else {
      const { _id, ...fields } = doc;
      await this.client
        .transaction()
        .patch(_id, (p) => p.ifRevisionId(decision.requiredRev).set(fields))
        .commit();
    }

    // Re-read and confirm the EXACT owner before anything is touched.
    const confirmed = await this.read();
    const ownership = evaluateLeaseOwnership({ existing: confirmed, owner: this.owner, now });
    if (!ownership.ok) {
      throw new LeaseError(ownership.reason, `Lease acquisition could not be confirmed (${ownership.reason}).`);
    }
    this.held = true;
    console.log(`  lease:     held by ${this.owner} until ${confirmed.expiresAt}`);
    return confirmed;
  }

  /** Re-read the lease and fail unless this run is still the exact live owner. */
  async assertOwned(now = new Date().toISOString()) {
    const existing = await this.read();
    const ownership = evaluateLeaseOwnership({ existing, owner: this.owner, now });
    if (!ownership.ok) {
      throw new LeaseError(ownership.reason, `Lease ownership check failed (${ownership.reason}). No fixture was touched.`);
    }
    return existing;
  }

  async renew(now = new Date().toISOString()) {
    const existing = await this.read();
    const decision = evaluateLeaseRenewal({ existing, owner: this.owner, now, ttlMs: this.ttlMs });
    if (decision.action === "refuse") {
      throw new LeaseError(decision.reason, `Cannot renew the lease (${decision.reason}).`);
    }
    await this.client
      .transaction()
      .patch(LEASE_DOC_ID, (p) => p.ifRevisionId(decision.requiredRev).set({ expiresAt: decision.expiresAt }))
      .commit();
    return decision.expiresAt;
  }

  /** Release. Runs in `finally`; never throws past a warning, never steals. */
  async release() {
    if (!this.held) return;
    try {
      const existing = await this.read();
      const decision = evaluateLeaseRelease({ existing, owner: this.owner });
      if (decision.action === "delete") {
        await this.client
          .transaction()
          // The `_rev` precondition on the patch guards the delete in the same
          // transaction, so a lease replaced since our read is never removed.
          .patch(LEASE_DOC_ID, (p) => p.ifRevisionId(decision.requiredRev).set({ releasing: true }))
          .delete(LEASE_DOC_ID)
          .commit();
        console.log(`  lease:     released`);
      } else if (decision.action === "refuse") {
        console.warn(`  lease:     NOT released — ${decision.reason}. Left intact deliberately.`);
      }
    } catch (err) {
      console.warn(`  lease:     release failed (${err.message}). It will expire on its own.`);
    } finally {
      this.held = false;
    }
  }
}
