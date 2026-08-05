// Server-side read/inventory helpers shared by the protected role writers
// (Service Readiness A2 §1/§2/§3), plus the ONE legacy-lock maintenance
// transaction of §1.
//
// Every canonical read goes through A1's canonical operational clients and A1's
// bound query builders — there is no ad-hoc GROQ here. Business content
// transactions deliberately stay in their route handlers; the only write in this
// module is the legacy bootstrap, which touches an unchanged target field plus
// its own coordination document and is identical for edit, delete, and publish.
//
// `server-only` keeps the tokened clients out of any client bundle.

import "server-only";

import { randomUUID } from "node:crypto";

import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import { writeClient } from "@/sanity/lib/serverClient";
import {
  canonicalMembersByIdsQuery,
  canonicalRoleByIdQuery,
  canonicalRolesByIdsQuery,
  canonicalSetlistsForWeeksQuery,
  canonicalSpecialRolesForDateQuery,
  canonicalWeekendRolesForTargetQuery,
  documentsReferencingRoleQuery,
  proposalsForRoleOrDatesQuery,
  rawProposalDraftsForRoleOrDatesQuery,
  rawRoleDraftForBaseQuery,
  rawRoleDraftsForBaseIdsQuery,
  rawRoleDraftsForTargetQuery,
  rawSetlistDraftsForWeeksQuery,
  rawSpecialRoleDraftsForDateQuery,
  roleCreationReceiptByIdQuery,
  roleCreationReceiptsForRoleQuery,
  roleTargetLocksByIdsQuery,
} from "@/app/utils/serviceReadQueries";
import { normalizeServiceName } from "./normalizeLabel";
import {
  canonicalGroupState,
  normalizeBaseId,
  validateRole,
  type CanonicalGroupState,
  type RoleType,
} from "./serviceReadModel";
import { pickUnique } from "./serviceReadSelect";
import { buildClaimedLock, roleTargetLockId } from "./roleTargetLock";
import type { ServiceErrorCode } from "./serviceMutation";
import {
  isCanonicalDocumentId,
  isSpecialRoleType,
  planOwnedLock,
  roleDateField,
  sanityConflictKind,
  storedRoleDate,
} from "./roleWriteRequest";
import {
  inventoryRoleDependencies,
  type RoleDependencyInventory,
  type RoleDependencyOperation,
} from "./roleDependencies";

/** Sanity array-of-object items each need their own `_key`. */
export function nextKey(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export interface StoredRole {
  _id: string;
  _rev: string;
  _type: RoleType;
  week?: string;
  date?: string;
  service_name?: string;
  published?: boolean;
  songs?: unknown[];
  creationReceiptId?: string;
  creationFingerprint?: string;
  Lead?: unknown[];
  BGVs?: unknown[];
  Chorus?: unknown[];
  instruments?: unknown[];
  foh_team?: unknown[];
}

export interface StoredLock {
  _id: string;
  _rev: string;
  _type: string;
  targetKey?: string;
  state?: string;
  roleId?: string;
  roleType?: string;
  date?: string;
  claimNonce?: string;
  generation?: number;
}

export interface StoredReceipt {
  _id: string;
  _rev: string;
  _type: string;
  requestId?: string;
  fingerprint?: string;
  roleId?: string;
  roleType?: string;
  targetIdentity?: string;
  state?: string;
}

async function run<T>(bound: { query: string; params: Record<string, unknown> }): Promise<T[]> {
  const rows = await operationalClient.fetch<T[]>(bound.query, bound.params);
  return Array.isArray(rows) ? rows : [];
}

async function runRaw<T>(bound: { query: string; params: Record<string, unknown> }): Promise<T[]> {
  const rows = await rawIntegrityClient.fetch<T[]>(bound.query, bound.params);
  return Array.isArray(rows) ? rows : [];
}

// ── Role identity ───────────────────────────────────────────────────────────

export interface CanonicalRoleLookup {
  role: StoredRole | null;
  state: CanonicalGroupState;
  /** Raw `drafts.` overlay ids for the same base id — a blocking integrity issue. */
  draftIds: string[];
}

/**
 * Resolve one role id to exactly one canonical role, plus its raw draft overlay.
 * Zero or many is never an arbitrary pick (`pickUnique`), and a draft overlay is
 * reported rather than silently ignored.
 */
export async function loadCanonicalRole(id: string): Promise<CanonicalRoleLookup> {
  const [rows, drafts] = await Promise.all([
    run<StoredRole>(canonicalRoleByIdQuery(id)),
    runRaw<{ _id: string }>(rawRoleDraftForBaseQuery(id)),
  ]);
  return {
    role: pickUnique(rows),
    state: canonicalGroupState(rows.length),
    draftIds: drafts.map((d) => d._id),
  };
}

export async function loadCanonicalRolesByIds(ids: string[]): Promise<StoredRole[]> {
  if (!ids.length) return [];
  return run<StoredRole>(canonicalRolesByIdsQuery(ids));
}

export async function loadRawRoleDraftIdsForBaseIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await runRaw<{ _id: string }>(rawRoleDraftsForBaseIdsQuery(ids));
  return rows.map((r) => r._id);
}

// ── Coordination documents ──────────────────────────────────────────────────

export async function loadLock(lockId: string | null): Promise<StoredLock | null> {
  if (!lockId) return null;
  const rows = await run<StoredLock>(roleTargetLocksByIdsQuery([lockId]));
  return pickUnique(rows.filter((r) => r._id === lockId));
}

export async function loadLocks(lockIds: string[]): Promise<Map<string, StoredLock>> {
  const unique = [...new Set(lockIds)];
  const out = new Map<string, StoredLock>();
  if (!unique.length) return out;
  for (const row of await run<StoredLock>(roleTargetLocksByIdsQuery(unique))) {
    if (out.has(row._id)) continue;
    out.set(row._id, row);
  }
  return out;
}

export async function loadReceiptById(receiptId: string): Promise<StoredReceipt | null> {
  return pickUnique(await run<StoredReceipt>(roleCreationReceiptByIdQuery(receiptId)));
}

/** Every receipt whose immutable `roleId` names this role (>1 = integrity conflict). */
export async function loadReceiptsForRole(roleId: string): Promise<StoredReceipt[]> {
  return run<StoredReceipt>(roleCreationReceiptsForRoleQuery(roleId));
}

/** Canonical member ids that actually resolve, for dangling-assignment refusal. */
export async function loadCanonicalMemberIds(ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return new Set();
  const rows = await run<{ _id: string }>(canonicalMembersByIdsQuery(unique));
  return new Set(rows.map((r) => r._id).filter((id): id is string => typeof id === "string"));
}

// ── Shared write-target resolution (§2/§4) ──────────────────────────────────

/** A rejection a route turns into `serviceError(code, { details })`. */
export interface RoleWriteFailure {
  code: ServiceErrorCode;
  details: Record<string, unknown>;
}

export interface RoleWriteTarget {
  role: StoredRole;
  targetKey: string;
  /** Deterministic weekend lock id; null for a special service. */
  lockId: string | null;
  date: string;
}

export type RoleWriteLoad =
  | { ok: true; target: RoleWriteTarget }
  | { ok: false; failure: RoleWriteFailure };

/**
 * Resolve one role id to exactly one canonical role, its canonical target and its
 * coordination token, and assert the revision the client observed. A non-canonical
 * id, ambiguity, a raw draft overlay, a structurally invalid role, an unusable
 * date, or a stale observed revision all fail closed BEFORE any write.
 */
export async function loadRoleForWrite(id: string, rev: string): Promise<RoleWriteLoad> {
  if (!isCanonicalDocumentId(id)) {
    return { ok: false, failure: { code: "invalid_request", details: { issues: ["id"] } } };
  }
  const lookup = await loadCanonicalRole(id);
  if (lookup.state === "none") {
    return { ok: false, failure: { code: "not_found", details: { id } } };
  }
  if (lookup.state !== "single" || !lookup.role) {
    return { ok: false, failure: { code: "ambiguous_target", details: { id, state: lookup.state } } };
  }
  if (lookup.draftIds.length) {
    return {
      ok: false,
      failure: { code: "integrity_conflict", details: { id, rawDrafts: lookup.draftIds } },
    };
  }
  const role = lookup.role;
  const validation = validateRole(role);
  if (!validation.groupable || !validation.targetKey) {
    return {
      ok: false,
      failure: { code: "integrity_conflict", details: { id, issues: validation.issues } },
    };
  }
  if (role._rev !== rev) {
    return {
      ok: false,
      failure: {
        code: "stale_revision",
        details: { id, storedRev: role._rev, observedRev: rev },
      },
    };
  }
  const date = storedRoleDate(role);
  if (!date) {
    return {
      ok: false,
      failure: { code: "integrity_conflict", details: { id, issues: ["date"] } },
    };
  }
  return {
    ok: true,
    target: {
      role,
      date,
      targetKey: validation.targetKey,
      lockId: roleTargetLockId(validation.targetKey),
    },
  };
}

export interface CoordinatedRole {
  /** The role to guard, refetched when a legacy lock had to be bootstrapped. */
  role: StoredRole;
  targetKey: string;
  date: string;
  /** The owned weekend token to assert/heartbeat; null for a special service. */
  lock: StoredLock | null;
}

export type RoleCoordination =
  | { ok: true; roles: CoordinatedRole[]; bootstrapped: false }
  | { ok: false; failure: RoleWriteFailure };

/**
 * Resolve the coordination token every involved role must already own, so ONE
 * business transaction can assert all of them. A wrong-owner, vacant or malformed
 * token is an integrity conflict and is never repaired implicitly; exactly one
 * legacy weekend role with no token runs the §1 bootstrap maintenance transaction.
 * Any maintenance commit, concurrent maintenance, or uncertain persistence stops
 * the complete logical operation; callers never continue into a business write.
 */
export async function resolveOwnedCoordination(
  targets: readonly RoleWriteTarget[],
): Promise<RoleCoordination> {
  const out: CoordinatedRole[] = [];
  const lockIds = targets
    .map((t) => t.lockId)
    .filter((id): id is string => typeof id === "string");
  const locks = await loadLocks(lockIds);

  for (const target of targets) {
    const { lockId, targetKey } = target;
    if (!lockId) {
      // A special service is serialized by its own document revision.
      out.push({ role: target.role, targetKey, date: target.date, lock: null });
      continue;
    }
    const plan = planOwnedLock({
      lock: locks.get(lockId) ?? null,
      targetKey,
      roleId: target.role._id,
    });
    if (plan.kind === "integrity") {
      return {
        ok: false,
        failure: { code: "integrity_conflict", details: { lockId, detail: plan.detail } },
      };
    }
    if (plan.kind === "bootstrap") {
      const boot = await bootstrapLegacyLock({
        roleId: target.role._id,
        roleRev: target.role._rev,
        targetKey,
        dateField: roleDateField(target.role._type),
        date: target.date,
      });
      const code =
        boot.outcome === "committed_reload"
          ? "bootstrap_completed_reload"
          : boot.outcome === "unknown"
            ? "bootstrap_outcome_unknown"
            : "stale_revision";
      return {
        ok: false,
        failure: {
          code,
          details: { ...boot.details, id: target.role._id },
        },
      };
    }
    out.push({
      role: target.role,
      targetKey,
      date: target.date,
      lock: locks.get(lockId) as StoredLock,
    });
  }
  return { ok: true, roles: out, bootstrapped: false };
}

// ── Target occupancy ────────────────────────────────────────────────────────

export interface TargetOccupancy {
  /** Canonical role ids already occupying the target (excluding `excludeRoleId`). */
  canonicalRoleIds: string[];
  /** Raw `drafts.*` overlays at the target — never adopted, always a conflict. */
  rawDraftIds: string[];
}

/**
 * Who already occupies a service target. A weekend target is `type` + `week`; a
 * special service is identified by its calendar day plus its normalized name.
 */
export async function loadTargetOccupancy(input: {
  roleType: RoleType;
  date: string;
  serviceName?: string | null;
  excludeRoleId?: string | null;
}): Promise<TargetOccupancy> {
  const special = isSpecialRoleType(input.roleType);
  const [rows, drafts] = await Promise.all([
    run<StoredRole>(
      special
        ? canonicalSpecialRolesForDateQuery(input.date)
        : canonicalWeekendRolesForTargetQuery(input.roleType, input.date),
    ),
    runRaw<{ _id: string; service_name?: string }>(
      special
        ? rawSpecialRoleDraftsForDateQuery(input.date)
        : rawRoleDraftsForTargetQuery(input.roleType, input.date),
    ),
  ]);
  // `normalizeServiceName` is the SHARED definition (`normalizeLabel.ts`) — the
  // same one `roleCreationReceipt` fingerprints with and the same one the client
  // planner grid keys its collision check with. It used to be re-implemented
  // inline here, one silent edit away from letting a duplicate special through.
  const wanted = normalizeServiceName(input.serviceName);
  return {
    canonicalRoleIds: rows
      .filter((r) => r._id !== input.excludeRoleId)
      .filter((r) => !special || normalizeServiceName(r.service_name) === wanted)
      .map((r) => r._id),
    rawDraftIds: drafts
      .filter(
        (draft) =>
          !special ||
          normalizeBaseId(draft._id) === input.excludeRoleId ||
          normalizeServiceName(draft.service_name) === wanted,
      )
      .map((draft) => draft._id),
  };
}

// ── Dependency inventory (§3) ───────────────────────────────────────────────

/**
 * Inventory every dependency that blocks a create/move/delete for the affected
 * date(s). Weekend setlists are DATE-keyed and hold no reference to the role, so
 * they are fetched by explicit date scope; proposals are fetched through both the
 * role reference and the affected dates, across every status, canonical and raw.
 */
export async function loadDependencies(input: {
  operation: RoleDependencyOperation;
  role?: StoredRole | null;
  target?: { roleType: RoleType; date: string };
  newDate?: string | null;
}): Promise<RoleDependencyInventory> {
  const dates = new Set<string>();
  if (input.target?.date) dates.add(input.target.date);
  const roleDate = input.role ? storedRoleDate(input.role) : null;
  if (roleDate) dates.add(roleDate);
  if (input.newDate) dates.add(input.newDate);
  const dateList = [...dates];
  const roleId = input.role?._id ?? null;

  const [canonicalSetlists, rawSetlistDrafts, canonicalProposals, rawProposalDrafts, unknownReferences] =
    await Promise.all([
      run<unknown>(canonicalSetlistsForWeeksQuery(dateList)),
      runRaw<unknown>(rawSetlistDraftsForWeeksQuery(dateList)),
      run<unknown>(proposalsForRoleOrDatesQuery(roleId, dateList)),
      runRaw<unknown>(rawProposalDraftsForRoleOrDatesQuery(roleId, dateList)),
      roleId ? run<unknown>(documentsReferencingRoleQuery(roleId)) : Promise.resolve([]),
    ]);

  return inventoryRoleDependencies({
    operation: input.operation,
    role: input.role ?? undefined,
    target: input.target,
    newDate: input.newDate ?? null,
    canonicalSetlists,
    rawSetlistDrafts,
    canonicalProposals,
    rawProposalDrafts,
    unknownReferences,
  });
}

// ── Legacy lock bootstrap (§1 maintenance boundary) ─────────────────────────

export type BootstrapOutcome = "not_committed" | "committed_reload" | "unknown";

export interface BootstrapEvidence {
  roleId: string;
  lockId: string | null;
  attemptedRoleRev: string;
  observedRoleRev?: string;
  observedLockRev?: string;
  commit: "succeeded" | "rejected";
  commitFailure?: "already_exists" | "revision_mismatch" | "conflict" | "unclassified";
  nonceEvidence: "exact" | "different" | "absent" | "unreadable";
  cause: string;
}

export interface BootstrapResult {
  outcome: BootstrapOutcome;
  /** Non-secret reconciliation evidence. The attempted nonce is never exposed. */
  details: BootstrapEvidence;
}

function expectedBootstrapRole(
  role: StoredRole | null,
  input: {
    roleId: string;
    targetKey: string;
    dateField: "week" | "date";
    date: string;
  },
): role is StoredRole {
  if (!role || role._id !== input.roleId) return false;
  const validation = validateRole(role);
  return (
    validation.groupable &&
    validation.targetKey === input.targetKey &&
    validation.serviceDate === input.date &&
    roleDateField(role._type) === input.dateField
  );
}

function validBootstrapLock(
  lock: StoredLock,
  input: { roleId: string; targetKey: string; date: string },
): boolean {
  const lockId = roleTargetLockId(input.targetKey);
  const roleType = input.targetKey.slice(0, input.targetKey.indexOf(":"));
  return (
    !!lockId &&
    lock._id === lockId &&
    typeof lock._rev === "string" &&
    lock._rev.length > 0 &&
    lock._type === "roleTargetLock" &&
    lock.targetKey === input.targetKey &&
    lock.state === "claimed" &&
    lock.roleId === input.roleId &&
    lock.roleType === roleType &&
    lock.date === input.date &&
    typeof lock.claimNonce === "string" &&
    lock.claimNonce.length > 0 &&
    typeof lock.generation === "number" &&
    Number.isInteger(lock.generation) &&
    lock.generation >= 0
  );
}

interface BootstrapReadback {
  role: StoredRole | null;
  roleState: CanonicalGroupState;
  draftIds: string[];
  lock: StoredLock | null;
  lockState: "absent" | "single" | "malformed";
}

async function loadBootstrapReadback(roleId: string, lockId: string): Promise<BootstrapReadback> {
  const roleQuery = canonicalRoleByIdQuery(roleId);
  const draftQuery = rawRoleDraftForBaseQuery(roleId);
  const lockQuery = roleTargetLocksByIdsQuery([lockId]);
  const [roles, drafts, locks] = await Promise.all([
    operationalClient.fetch<StoredRole[]>(roleQuery.query, roleQuery.params),
    rawIntegrityClient.fetch<{ _id: string }[]>(draftQuery.query, draftQuery.params),
    operationalClient.fetch<StoredLock[]>(lockQuery.query, lockQuery.params),
  ]);
  if (!Array.isArray(roles) || !Array.isArray(drafts) || !Array.isArray(locks)) {
    throw new Error("malformed bootstrap readback");
  }
  if (drafts.some((draft) => !draft || typeof draft._id !== "string")) {
    throw new Error("malformed bootstrap draft readback");
  }
  const lock = locks.length === 1 && locks[0]?._id === lockId ? locks[0] : null;
  return {
    role: pickUnique(roles),
    roleState: canonicalGroupState(roles.length),
    draftIds: drafts.map((draft) => draft._id),
    lock,
    lockState: locks.length === 0 ? "absent" : lock ? "single" : "malformed",
  };
}

/**
 * Bootstrap the missing lock of exactly one canonical legacy weekend role. All
 * body/id/type/cardinality, client-observed revision, raw-draft, ambiguity, and
 * dependency validation must already have passed — an invalid request writes
 * nothing.
 *
 * The maintenance transaction revision-guards and heartbeats ONLY the role's
 * unchanged target field, and `create`s its claimed lock (so concurrent
 * bootstrappers serialize on the deterministic lock id). Afterwards role and lock
 * are refetched only to classify persistence. A maintenance commit always ends
 * this request with `committed_reload`; no caller may continue into a business
 * write. A rejected/lost commit is `not_committed` only when readback conclusively
 * observes the exact pre-bootstrap role and no lock. Every other observation is
 * `unknown` and forbids automatic retry.
 */
export async function bootstrapLegacyLock(input: {
  roleId: string;
  roleRev: string;
  targetKey: string;
  dateField: "week" | "date";
  date: string;
}): Promise<BootstrapResult> {
  const claimNonce = randomUUID();
  const lock = buildClaimedLock({
    targetKey: input.targetKey,
    roleId: input.roleId,
    claimNonce,
    now: nowIso(),
  });
  if (!lock) {
    return {
      outcome: "unknown",
      details: {
        roleId: input.roleId,
        lockId: roleTargetLockId(input.targetKey),
        attemptedRoleRev: input.roleRev,
        commit: "rejected",
        nonceEvidence: "unreadable",
        cause: "invalid_bootstrap_plan",
      },
    };
  }

  let commit: BootstrapEvidence["commit"] = "succeeded";
  let commitFailure: BootstrapEvidence["commitFailure"];
  try {
    await writeClient
      .transaction()
      .patch(input.roleId, (p) =>
        p.ifRevisionId(input.roleRev).set({ [input.dateField]: input.date }),
      )
      .create(lock)
      .commit();
  } catch (error) {
    commit = "rejected";
    const kind = sanityConflictKind(error);
    commitFailure = kind ?? "unclassified";
  }

  try {
    const refetched = await loadBootstrapReadback(input.roleId, lock._id);
    const role = refetched.role;
    const refetchedLock = refetched.lock;
    const roleIsExpected =
      refetched.roleState === "single" &&
      refetched.draftIds.length === 0 &&
      expectedBootstrapRole(role, input);
    const observedRoleRev = role?._rev;
    const observedLockRev = refetchedLock?._rev;
    const nonceEvidence = refetched.lockState === "absent"
      ? "absent"
      : refetched.lockState === "single" && refetchedLock && validBootstrapLock(refetchedLock, input)
        ? refetchedLock.claimNonce === claimNonce
          ? "exact"
          : "different"
        : "unreadable";

    if (commit === "succeeded") {
      return {
        outcome: "committed_reload",
        details: {
          roleId: input.roleId,
          lockId: lock._id,
          attemptedRoleRev: input.roleRev,
          ...(observedRoleRev ? { observedRoleRev } : {}),
          ...(observedLockRev ? { observedLockRev } : {}),
          commit,
          nonceEvidence,
          cause: "commit_succeeded",
        },
      };
    }

    const baseDetails = {
      roleId: input.roleId,
      lockId: lock._id,
      attemptedRoleRev: input.roleRev,
      ...(observedRoleRev ? { observedRoleRev } : {}),
      ...(observedLockRev ? { observedLockRev } : {}),
      commit,
      ...(commitFailure ? { commitFailure } : {}),
      nonceEvidence,
    } satisfies Omit<BootstrapEvidence, "cause">;

    if (
      roleIsExpected &&
      observedRoleRev !== input.roleRev &&
      refetchedLock &&
      validBootstrapLock(refetchedLock, input)
    ) {
      return {
        outcome: "committed_reload",
        details: {
          ...baseDetails,
          cause: nonceEvidence === "exact" ? "attempted_nonce_observed" : "concurrent_nonce_observed",
        },
      };
    }

    if (roleIsExpected && observedRoleRev === input.roleRev && refetched.lockState === "absent") {
      return {
        outcome: "not_committed",
        details: { ...baseDetails, cause: "prebootstrap_state_observed" },
      };
    }

    return {
      outcome: "unknown",
      details: { ...baseDetails, cause: "inconclusive_readback" },
    };
  } catch {
    return {
      outcome: commit === "succeeded" ? "committed_reload" : "unknown",
      details: {
        roleId: input.roleId,
        lockId: lock._id,
        attemptedRoleRev: input.roleRev,
        commit,
        ...(commitFailure ? { commitFailure } : {}),
        nonceEvidence: "unreadable",
        cause: "readback_failed",
      },
    };
  }
}
