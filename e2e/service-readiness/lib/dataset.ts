// Service Readiness A3 §4 — the harness's isolated-dataset access: the exclusive
// lease, deterministic fixture reset, and post-mutation re-query.
//
// EVERY guard, the lease contract, the deterministic fixture set and the closed
// deletion allowlist are REUSED from `scripts/lib/sr-verification.mjs` and
// `scripts/lib/sr-verification-runtime.mjs`. Nothing here re-decides any of that:
// this module is a thin adapter that lets a Playwright worker act on the same
// decisions the guarded operator scripts act on.
//
// The client comes ONLY from `makeVerificationClient`, which throws unless
// `evaluateGuards(...).willContactRemote === true` — and those guards hard-refuse
// production project `ebb8vcnk` and dataset `production` on either axis, dry-run
// included. There is no second code path to the Content Lake in this harness.
//
// WHY the fixture reset runs in-process instead of spawning
// `scripts/service-readiness-verification-{seed,reset}.mjs`: those are CLI entry
// points that acquire the lease and RELEASE it in their own `finally`. Spawning one
// mid-run would delete the lease the harness is holding, opening a window in which
// another run could claim the dataset and in which `auth.ts`'s login-event ownership
// gate would start failing closed. So the harness holds ONE lease for the whole run
// and performs the same allowlist-only reset through the same shared primitives —
// `fixtureIds()`, `filterDeletableIds()`, `buildFixtureDocuments()`,
// `verifyFixtureState()`. The CLI scripts remain the operator-facing entry points for
// the initial seed and the outermost teardown.
//
// Deletion is EXACT-ID ONLY, from two closed sources and nothing else:
//   1. `filterDeletableIds(fixtureIds())` — the deterministic fixtures, the same list
//      the reset script uses (the marker and the lease are refused by that filter);
//   2. `readCreatedDocuments()` — ids this run recorded at the moment a deployed route
//      created them.
// There is no discovery query, no `*[_type == ...]` deletion, and no pattern match.
//
// This file is listed in `OPERATOR_TOOLING_ALLOWLIST` (app/utils/protectedReadAudit.ts)
// because it deliberately reads and writes the protected role/setlist/proposal types
// in the isolated dataset. That listing is the audit working, not the audit weakened.

import {
  ADMIN_HASH_ENV,
  INFRASTRUCTURE_IDS,
  LEASE_DOC_ID,
  MARKER_DOC_ID,
  MEMBER_HASH_ENV,
  TOKEN_ENV,
  buildFixtureDocuments,
  evaluateGuards,
  filterDeletableIds,
  fixtureIds,
  verifyFixtureState,
} from "../../../scripts/lib/sr-verification.mjs";
import {
  DatasetLease,
  fetchByIds,
  makeVerificationClient,
} from "../../../scripts/lib/sr-verification-runtime.mjs";

import { evaluateCreatedId, readCreatedDocuments } from "./createdDocs";
import type { RunIdentity } from "./runIdentity";

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

interface MinimalClient {
  fetch<T = unknown>(query: string, params?: Record<string, unknown>): Promise<T>;
  getDocument<T = unknown>(id: string): Promise<T | undefined>;
  transaction(): {
    delete(id: string): unknown;
    create(doc: Record<string, unknown>): unknown;
    createOrReplace(doc: Record<string, unknown>): unknown;
    commit(): Promise<unknown>;
  };
}

let cached: MinimalClient | null = null;

/**
 * The one Sanity client this harness may use, per worker process. Built through the
 * guarded factory, so a misconfigured environment throws here rather than reaching
 * the Content Lake.
 */
export function datasetClient(): MinimalClient {
  if (cached) return cached;
  const guards = evaluateGuards({ env: process.env, apply: true, requireAdminHash: false });
  if (guards.refused) {
    const codes = [...guards.hardFailures, ...guards.applyBlockers].map(
      (f: { code: string; message: string }) => `[${f.code}] ${f.message}`,
    );
    throw new Error(`Refusing to build a verification Sanity client:\n  ${codes.join("\n  ")}`);
  }
  const client = makeVerificationClient(guards, process.env[TOKEN_ENV]) as MinimalClient;
  cached = client;
  return client;
}

/** Re-exported so the harness and the operator scripts name the same documents. */
export { LEASE_DOC_ID, MARKER_DOC_ID, ADMIN_HASH_ENV, MEMBER_HASH_ENV };

/* ------------------------------------------------------------------ *
 * Exclusive dataset lease
 * ------------------------------------------------------------------ */

export interface LeaseHandle {
  owner: string;
  assertOwned(): Promise<void>;
  renew(): Promise<void>;
  release(): Promise<void>;
}

/**
 * Acquire the exclusive lease for `runId:candidateSha:deploymentId`.
 *
 * A live FOREIGN lease fails immediately — it is never stolen and never deleted.
 * `auth.ts`'s login-event ownership gate reads this same document, so holding it is
 * also what makes run-owned login events possible.
 */
export async function acquireRunLease(identity: RunIdentity): Promise<LeaseHandle> {
  const lease = new DatasetLease(datasetClient(), identity);
  await lease.acquire();
  return {
    owner: lease.owner as string,
    assertOwned: async () => {
      await lease.assertOwned();
    },
    renew: async () => {
      await lease.renew();
    },
    release: async () => {
      await lease.release();
    },
  };
}

/**
 * Per-worker ownership re-check. Workers are separate processes and cannot share the
 * `DatasetLease` instance, so each one RE-READS the lease document and compares the
 * exact owner before it touches anything. Same contract, same helper.
 */
export async function assertLeaseOwned(identity: RunIdentity): Promise<void> {
  const lease = new DatasetLease(datasetClient(), identity);
  await lease.assertOwned();
}

/* ------------------------------------------------------------------ *
 * Deterministic fixture reset
 * ------------------------------------------------------------------ */

export interface ResetResult {
  /** Deterministic fixture ids removed and rewritten. */
  fixtures: string[];
  /** Run-created ids removed by exact id. */
  runCreated: string[];
  /** Generated ids that failed the closed allowlist — reported, never deleted. */
  refused: string[];
}

/**
 * The complete, closed deletion target list for a reset. Exported so the offline test
 * can prove it never contains the marker, the lease, or anything the run did not
 * either seed deterministically or record as created.
 */
export function resetDeletionTargets(): { fixtures: string[]; runCreated: string[]; refused: string[] } {
  const { allowed, refused } = filterDeletableIds(fixtureIds() as string[]) as {
    allowed: string[];
    refused: string[];
  };
  const infrastructure = new Set(INFRASTRUCTURE_IDS as readonly string[]);
  const fixtures = new Set(allowed);
  const runCreated = readCreatedDocuments().filter(
    (id) => !infrastructure.has(id) && !fixtures.has(id),
  );
  return { fixtures: allowed, runCreated, refused };
}

/**
 * The member fixtures that carry a password hash, and the env var each hash comes
 * from. Password hashes are never part of the committed fixture definition, so EVERY
 * path that rewrites the fixtures has to re-inject them — the seed script and this
 * reset alike. Omitting one silently removes that member's ability to sign in, which
 * surfaces as an opaque sign-in timeout rather than as a configuration error.
 */
const FIXTURE_PASSWORD_HASHES: ReadonlyArray<{ id: string; env: string }> = Object.freeze([
  { id: "srv.member.admin", env: ADMIN_HASH_ENV },
  { id: "srv.member.lead", env: MEMBER_HASH_ENV },
]);

/**
 * Reset to the exact seeded state.
 *
 * The seeded members' password hashes are re-injected from the runner environment,
 * since they are never part of the committed fixture definition.
 */
export async function resetFixtures(identity: RunIdentity): Promise<ResetResult> {
  await assertLeaseOwned(identity);
  const client = datasetClient();
  const now = new Date().toISOString();

  const { fixtures, runCreated, refused } = resetDeletionTargets();
  const documents = buildFixtureDocuments({ now }) as Array<Record<string, unknown>>;

  for (const { id, env } of FIXTURE_PASSWORD_HASHES) {
    const hash = process.env[env];
    if (typeof hash !== "string" || !hash.length) continue;
    for (const doc of documents) {
      if (doc._id === id) doc.passwordHash = hash;
    }
  }

  // ONE transaction: every allowlisted id and every run-created id is removed, and
  // every fixture is written back at its deterministic id — so a scenario always
  // starts from byte-identical state regardless of what the previous one mutated.
  const tx = client.transaction();
  for (const id of [...fixtures, ...runCreated]) tx.delete(id);
  for (const doc of documents) tx.createOrReplace(doc);
  await tx.commit();

  // Post-apply exactness, using the shared verifier.
  const actual = (await fetchByIds(client, documents.map((d) => d._id as string))) as Array<
    Record<string, unknown>
  >;
  const verdict = verifyFixtureState({ expected: documents, actual }) as {
    ok: boolean;
    failures: Array<{ code: string; id: string }>;
  };
  if (!verdict.ok) {
    throw new Error(
      `Fixture reset did not produce the exact expected state:\n  ` +
        verdict.failures.map((f) => `[${f.code}] ${f.id}`).join("\n  "),
    );
  }

  return { fixtures, runCreated, refused };
}

/* ------------------------------------------------------------------ *
 * Scenario-local integrity fixtures
 * ------------------------------------------------------------------ */

/**
 * Write ONE scenario-local document that the guarded routes deliberately cannot
 * produce — the A3 plan's "duplicate/draft-conflict/malformed fixtures created only
 * for the specific test that resets them afterward".
 *
 * A real duplicate target is the clearest example: two canonical roles on one
 * weekend target is precisely the state every guarded writer REFUSES to create, so
 * the only way to prove the integrity summary reports it is to plant it directly.
 *
 * Safety is the same discipline as everything else here:
 *   · the caller must already hold the live lease (re-checked);
 *   · the id must pass `evaluateCreatedId` — a deterministic fixture id, an
 *     infrastructure id (marker/lease) and a `drafts.` id are all REFUSED, so this
 *     can never overwrite seeded state or the lease;
 *   · the caller records the id in the run ledger, so the next per-scenario reset
 *     deletes it by exact id.
 * It is `create`, never `createOrReplace`: an id that already exists is a bug in the
 * scenario, not something to silently clobber.
 */
export async function createScenarioDocument(
  identity: RunIdentity,
  doc: Record<string, unknown>,
): Promise<void> {
  // The id check runs FIRST, before the lease and before any client is built, so a
  // refused id can never reach the Content Lake and the refusal is provable offline.
  const id = doc._id;
  const decision = evaluateCreatedId(id);
  if (!decision.ok) {
    throw new Error(
      `Refusing to plant scenario document "${String(id)}": ${decision.reason}. ` +
        `Deterministic fixtures and infrastructure documents are owned by the fixture reset.`,
    );
  }
  await assertLeaseOwned(identity);
  const client = datasetClient();
  const tx = client.transaction();
  tx.create(doc);
  await tx.commit();
}

/* ------------------------------------------------------------------ *
 * Post-mutation re-query
 *
 * Every scenario re-queries Sanity after a success OR a conflict, always under the
 * live lease. The reads below name the protected stored types on purpose — that is
 * exactly what makes this file a listed protected-read site.
 * ------------------------------------------------------------------ */

export interface StoredRole {
  _id: string;
  _rev: string;
  _type: string;
  week?: string | null;
  date?: string | null;
  service_name?: string | null;
  published?: boolean | null;
  Lead?: Array<{ _ref?: string; _key?: string }> | null;
  BGVs?: Array<{ _ref?: string; _key?: string }> | null;
  Chorus?: Array<{ _ref?: string; _key?: string }> | null;
  instruments?: Array<{ instrument?: string; person?: { _ref?: string }; _key?: string }> | null;
  foh_team?: Array<{ role?: string; person?: { _ref?: string }; _key?: string }> | null;
}

const ROLE_PROJECTION = `{
  _id, _rev, _type, week, date, service_name, published,
  Lead, BGVs, Chorus, instruments, foh_team
}`;

/** One stored role by id, restricted to the three role types. */
export async function readRole(identity: RunIdentity, id: string): Promise<StoredRole | null> {
  await assertLeaseOwned(identity);
  const client = datasetClient();
  return client.fetch<StoredRole | null>(
    `*[_id == $id && _type in ["sunday_role", "saturday_role", "special_role"]][0]${ROLE_PROJECTION}`,
    { id },
  );
}

/** Every stored role at one weekend/special date — the ambiguity check. */
export async function readRolesAtTarget(
  identity: RunIdentity,
  { type, date }: { type: string; date: string },
): Promise<StoredRole[]> {
  await assertLeaseOwned(identity);
  const client = datasetClient();
  return client.fetch<StoredRole[]>(
    `*[_type == $type && coalesce(week, date) == $date]${ROLE_PROJECTION}`,
    { type, date },
  );
}

export interface StoredSetlist {
  _id: string;
  _rev: string;
  _type: string;
  week?: string | null;
  songs?: Array<{ _key?: string; song?: { _ref?: string }; play_key?: string | null }> | null;
}

const SETLIST_PROJECTION = `{ _id, _rev, _type, week, songs }`;

/** One weekend setlist by id (`featuredSongs` Sunday / `saturdarSongs` Saturday). */
export async function readWeekendSetlist(
  identity: RunIdentity,
  id: string,
): Promise<StoredSetlist | null> {
  await assertLeaseOwned(identity);
  const client = datasetClient();
  return client.fetch<StoredSetlist | null>(
    `*[_id == $id && _type in ["featuredSongs", "saturdarSongs"]][0]${SETLIST_PROJECTION}`,
    { id },
  );
}

/** Every canonical weekend setlist for one week — the singleton/none check. */
export async function readWeekendSetlistsForWeek(
  identity: RunIdentity,
  { type, week }: { type: string; week: string },
): Promise<StoredSetlist[]> {
  await assertLeaseOwned(identity);
  const client = datasetClient();
  return client.fetch<StoredSetlist[]>(
    `*[_type == $type && week == $week]${SETLIST_PROJECTION}`,
    { type, week },
  );
}

/**
 * The approval receipt A2 §6 records. It is an EMBEDDED object on the proposal,
 * not a separate document: A2's "protected stored types" list introduces exactly
 * two new internal types (`roleTargetLock`, `roleCreationReceipt`) and no approval
 * receipt document, so the receipt lives inside the one transaction that marks the
 * proposal approved and writes the live setlist. There is therefore no receipt id
 * to dereference — the receipt IS the stored evidence.
 */
export interface StoredApprovalReceipt {
  v?: number | null;
  marker?: string | null;
  fingerprint?: string | null;
  serviceType?: string | null;
  serviceDate?: string | null;
  serviceRef?: string | null;
  setlistTargetKey?: string | null;
  setlistId?: string | null;
  songCount?: number | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
}

export interface StoredProposal {
  _id: string;
  _rev: string;
  _type: string;
  status?: string | null;
  service_type?: string | null;
  service_date?: string | null;
  service_ref?: { _ref?: string } | null;
  songs?: Array<{ _key?: string; song?: { _ref?: string } }> | null;
  admin_notes?: string | null;
  approval_receipt?: StoredApprovalReceipt | null;
  last_transition?: Record<string, unknown> | null;
}

const PROPOSAL_PROJECTION = `{
  _id, _rev, _type, status, service_type, service_date, service_ref, songs,
  admin_notes, approval_receipt, last_transition
}`;

/** Every `setlistProposal` for one service — the shared-singleton check. */
export async function readProposalsForRole(
  identity: RunIdentity,
  roleId: string,
): Promise<StoredProposal[]> {
  await assertLeaseOwned(identity);
  const client = datasetClient();
  return client.fetch<StoredProposal[]>(
    `*[_type == "setlistProposal" && service_ref._ref == $roleId]${PROPOSAL_PROJECTION}`,
    { roleId },
  );
}

export async function readProposal(
  identity: RunIdentity,
  id: string,
): Promise<StoredProposal | null> {
  await assertLeaseOwned(identity);
  const client = datasetClient();
  return client.fetch<StoredProposal | null>(
    `*[_id == $id && _type == "setlistProposal"][0]${PROPOSAL_PROJECTION}`,
    { id },
  );
}

/**
 * A non-protected sidecar document by id (creation receipt, weekend target lock,
 * approval receipt). Kept separate from the role/setlist/proposal reads so the
 * protected reads above stay an explicit, reviewable list.
 */
export async function readSidecar<T = Record<string, unknown>>(
  identity: RunIdentity,
  id: string,
): Promise<T | null> {
  await assertLeaseOwned(identity);
  const client = datasetClient();
  const doc = await client.getDocument<T>(id);
  return doc ?? null;
}
