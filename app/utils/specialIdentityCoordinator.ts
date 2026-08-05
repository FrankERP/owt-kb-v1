import "server-only";

import { randomUUID } from "node:crypto";

import { operationalClient } from "@/sanity/lib/operationalClient";

/**
 * One global mutex for special-service identity changes.
 *
 * Special services deliberately do not use weekend `roleTargetLock` documents.
 * Their own role revision serializes roster/content changes, but it cannot
 * serialize two different documents competing for the same normalized
 * `{date, service_name}` identity. Every special create and identity-changing
 * PATCH therefore asserts this one deterministic coordinator in the same
 * business transaction.
 */
export const SPECIAL_IDENTITY_COORDINATOR_TYPE = "specialIdentityCoordinator";
export const SPECIAL_IDENTITY_COORDINATOR_ID = "specialIdentityCoordinator.global";

export interface StoredSpecialIdentityCoordinator {
  _id: typeof SPECIAL_IDENTITY_COORDINATOR_ID;
  _rev: string;
  _type: typeof SPECIAL_IDENTITY_COORDINATOR_TYPE;
  version: number;
  claimNonce: string;
  updatedAt: string;
}

export interface SpecialIdentityCoordinatorDocument {
  _id: typeof SPECIAL_IDENTITY_COORDINATOR_ID;
  _type: typeof SPECIAL_IDENTITY_COORDINATOR_TYPE;
  version: 1;
  claimNonce: string;
  updatedAt: string;
}

export type SpecialIdentityCoordinatorClaimPlan =
  | {
      ok: true;
      kind: "create";
      document: SpecialIdentityCoordinatorDocument;
      claimNonce: string;
    }
  | {
      ok: true;
      kind: "patch";
      id: typeof SPECIAL_IDENTITY_COORDINATOR_ID;
      /** The route must pass this value to Sanity's `ifRevisionId(...)`. */
      ifRevisionId: string;
      set: { version: number; claimNonce: string; updatedAt: string };
      claimNonce: string;
    }
  | { ok: false; issues: string[] };

export type SpecialIdentityCoordinatorLoad =
  | { ok: true; coordinator: StoredSpecialIdentityCoordinator | null }
  | { ok: false; issues: string[] };

export interface SpecialIdentityCoordinatorQuery {
  query: string;
  params: { id: typeof SPECIAL_IDENTITY_COORDINATOR_ID };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validDateTime(value: unknown): value is string {
  return nonEmptyString(value) && value.includes("T") && Number.isFinite(Date.parse(value));
}

/** The one bound, published-perspective read for the deterministic coordinator. */
export function specialIdentityCoordinatorQuery(): SpecialIdentityCoordinatorQuery {
  return {
    query: `*[_type == "specialIdentityCoordinator" && _id == $id] {
      _id, _rev, _type, version, claimNonce, updatedAt
    }`,
    params: { id: SPECIAL_IDENTITY_COORDINATOR_ID },
  };
}

/**
 * Validate stored coordinator state. Malformed state is never repaired or
 * treated as absence: special identity writes must fail closed instead.
 */
export function validateSpecialIdentityCoordinator(
  value: unknown,
):
  | { ok: true; coordinator: StoredSpecialIdentityCoordinator }
  | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const doc = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  if (doc._id !== SPECIAL_IDENTITY_COORDINATOR_ID) issues.push("id");
  if (!nonEmptyString(doc._rev)) issues.push("rev");
  if (doc._type !== SPECIAL_IDENTITY_COORDINATOR_TYPE) issues.push("type");
  if (
    typeof doc.version !== "number" ||
    !Number.isSafeInteger(doc.version) ||
    doc.version < 1
  ) {
    issues.push("version");
  }
  if (!nonEmptyString(doc.claimNonce)) issues.push("claimNonce");
  if (!validDateTime(doc.updatedAt)) issues.push("updatedAt");

  if (issues.length) return { ok: false, issues };
  return { ok: true, coordinator: doc as unknown as StoredSpecialIdentityCoordinator };
}

/**
 * Load the global coordinator through the explicit published operational client.
 * A non-array result, duplicate row, or malformed singleton is an integrity
 * refusal, never inferred absence.
 */
export async function loadSpecialIdentityCoordinator(): Promise<SpecialIdentityCoordinatorLoad> {
  const bound = specialIdentityCoordinatorQuery();
  const rows = await operationalClient.fetch<unknown>(bound.query, bound.params);
  if (!Array.isArray(rows)) return { ok: false, issues: ["query_result"] };
  if (rows.length === 0) return { ok: true, coordinator: null };
  if (rows.length !== 1) return { ok: false, issues: ["cardinality"] };
  const validated = validateSpecialIdentityCoordinator(rows[0]);
  return validated.ok
    ? { ok: true, coordinator: validated.coordinator }
    : { ok: false, issues: validated.issues };
}

/**
 * Plan one claim. Missing state creates version 1. Existing state is asserted
 * under its observed revision and advances both version and nonce, guaranteeing
 * a real new revision rather than a no-op patch.
 */
export function planSpecialIdentityCoordinatorClaim(
  current: unknown | null,
  deps: { claimNonce?: () => string; now?: () => string } = {},
): SpecialIdentityCoordinatorClaimPlan {
  const claimNonce = (deps.claimNonce ?? randomUUID)();
  const updatedAt = (deps.now ?? (() => new Date().toISOString()))();
  if (!nonEmptyString(claimNonce)) return { ok: false, issues: ["newClaimNonce"] };
  if (!validDateTime(updatedAt)) return { ok: false, issues: ["newUpdatedAt"] };

  if (current == null) {
    return {
      ok: true,
      kind: "create",
      claimNonce,
      document: {
        _id: SPECIAL_IDENTITY_COORDINATOR_ID,
        _type: SPECIAL_IDENTITY_COORDINATOR_TYPE,
        version: 1,
        claimNonce,
        updatedAt,
      },
    };
  }

  const validated = validateSpecialIdentityCoordinator(current);
  if (!validated.ok) return validated;
  const observed = validated.coordinator;
  if (observed.version === Number.MAX_SAFE_INTEGER) {
    return { ok: false, issues: ["version_exhausted"] };
  }
  if (claimNonce === observed.claimNonce) {
    return { ok: false, issues: ["claimNonce_not_fresh"] };
  }

  return {
    ok: true,
    kind: "patch",
    id: SPECIAL_IDENTITY_COORDINATOR_ID,
    ifRevisionId: observed._rev,
    claimNonce,
    set: {
      version: observed.version + 1,
      claimNonce,
      updatedAt,
    },
  };
}
