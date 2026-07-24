// Persistent weekend target locks (Service Readiness A2 §1) — pure model.
//
// A `roleTargetLock` serializes writers competing for ONE weekend service target
// (`sunday_role:<week>` / `saturday_role:<week>`). Special roles are their own
// target and are serialized by their own document revision, so they never take a
// weekend lock.
//
// No Sanity client, no I/O: deterministic id derivation, invariant validation,
// and document/patch shapes over already-fetched values, so every rule is
// exhaustively unit-testable in memory before any writer is replaced.
//
// Invariants held here (plan §1):
//  - `claimed` has exactly one non-empty `roleId` whose canonical role owns the
//    SAME target key.
//  - `vacant` has no `roleId` and advances the generation.
//  - `roleId` is a plain string, never a strong reference — deleting a role must
//    not cascade into the lock, and a lock must never keep a deleted role alive.
//  - Wrong-owner / orphan locks are integrity issues, never implicitly reclaimed.

import { isValidServiceDate, roleTargetKey } from "@/app/utils/serviceReadModel";

export const ROLE_TARGET_LOCK_TYPE = "roleTargetLock";

export const LOCK_STATES = ["claimed", "vacant"] as const;
export type RoleTargetLockState = (typeof LOCK_STATES)[number];

/** Weekend role types that take a lock. `special_role` deliberately absent. */
const LOCKABLE_ROLE_TYPES = ["sunday_role", "saturday_role"] as const;
type LockableRoleType = (typeof LOCKABLE_ROLE_TYPES)[number];

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

interface ParsedTarget {
  roleType: LockableRoleType;
  date: string;
}

/**
 * Parse a weekend role target key. Returns null for a special-role target (its
 * own document id), a malformed key, or a non-calendar date — never a guess.
 */
function parseWeekendTarget(targetKey: unknown): ParsedTarget | null {
  if (typeof targetKey !== "string") return null;
  const at = targetKey.indexOf(":");
  if (at < 0) return null;
  const roleType = targetKey.slice(0, at);
  const date = targetKey.slice(at + 1);
  if (!(LOCKABLE_ROLE_TYPES as readonly string[]).includes(roleType)) return null;
  if (!isValidServiceDate(date)) return null;
  return { roleType: roleType as LockableRoleType, date };
}

/**
 * Deterministic lock id for a weekend target key:
 * `sunday_role:<week>`   -> `roleTarget.sunday_role.<week>`
 * `saturday_role:<week>` -> `roleTarget.saturday_role.<week>`
 * Anything else — a special role target, a malformed key, an invalid date —
 * returns null, meaning "this target takes no weekend lock".
 */
export function roleTargetLockId(targetKey: unknown): string | null {
  const parsed = parseWeekendTarget(targetKey);
  return parsed ? `roleTarget.${parsed.roleType}.${parsed.date}` : null;
}

/** Deterministic lock id for a stored role document, via its canonical target key. */
export function roleTargetLockIdForRole(role: {
  _type?: unknown;
  _id?: unknown;
  week?: unknown;
  date?: unknown;
}): string | null {
  return roleTargetLockId(roleTargetKey(role));
}

export type RoleTargetLockIssueKind =
  /** A canonical weekend target owns a role but has no lock document (bootstrap candidate). */
  | "missing_lock"
  /** Structurally unusable lock: bad type/identity/state/target/date/generation. */
  | "malformed_lock"
  /** Stored `_id` is not the deterministic id for its own `targetKey`. */
  | "id_mismatch"
  /** `state: claimed` with no `roleId`. */
  | "claimed_without_role"
  /** `state: vacant` that still names a `roleId`. */
  | "vacant_with_role"
  /** Claimed by a role that owns a DIFFERENT canonical target. */
  | "wrong_owner"
  /** Claimed by a role id that resolves to no canonical role. */
  | "orphan_lock";

export interface RoleTargetLockIssue {
  kind: RoleTargetLockIssueKind;
  lockId: string | null;
  targetKey: string | null;
  roleId?: string;
  detail?: string;
}

export interface RoleTargetLockValidation {
  /** True only when every §1 invariant holds. */
  valid: boolean;
  issues: RoleTargetLockIssue[];
  targetKey: string | null;
  state: RoleTargetLockState | null;
  roleId: string | null;
  generation: number | null;
}

/**
 * Resolve a role id to the canonical target key that role owns. Return null when
 * no canonical role with that id exists, or when it exists but is not groupable
 * — both are "this lock owns nothing real" (orphan).
 */
export type LockOwnerLookup = (roleId: string) => string | null;

/**
 * Validate one lock document against the §1 invariants. Never throws: a
 * malformed document (or a throwing owner lookup) becomes an explicit issue, so
 * one bad lock cannot fail unrelated targets.
 */
export function validateRoleTargetLock(
  lock: unknown,
  ownerTargetKey: LockOwnerLookup,
): RoleTargetLockValidation {
  const issues: RoleTargetLockIssue[] = [];
  const doc = isObj(lock) ? lock : {};
  const rawTargetKey = typeof doc.targetKey === "string" ? doc.targetKey : null;
  const lockId = nonEmptyString(doc._id) ? doc._id : null;
  const parsed = parseWeekendTarget(rawTargetKey);
  const targetKey = parsed ? rawTargetKey : null;

  const malformed = (detail: string) =>
    issues.push({ kind: "malformed_lock", lockId, targetKey, detail });

  if (!isObj(lock)) malformed("not_an_object");
  if (!nonEmptyString(doc._id) || !nonEmptyString(doc._rev)) malformed("identity");
  if (doc._type !== ROLE_TARGET_LOCK_TYPE) malformed("type");
  if (!parsed) malformed("target_key");

  const state = (LOCK_STATES as readonly unknown[]).includes(doc.state)
    ? (doc.state as RoleTargetLockState)
    : null;
  if (!state) malformed("state");

  if (parsed) {
    if (doc.roleType !== parsed.roleType) malformed("role_type");
    if (doc.date !== parsed.date) malformed("date");
    const derived = roleTargetLockId(rawTargetKey);
    if (lockId && derived && lockId !== derived) {
      issues.push({ kind: "id_mismatch", lockId, targetKey, detail: `expected ${derived}` });
    }
  }

  const generation =
    typeof doc.generation === "number" && Number.isInteger(doc.generation) && doc.generation >= 0
      ? doc.generation
      : null;
  if (generation === null) malformed("generation");

  const roleId = nonEmptyString(doc.roleId) ? doc.roleId : null;

  if (state === "claimed") {
    if (!roleId) {
      issues.push({ kind: "claimed_without_role", lockId, targetKey });
    } else {
      let ownedTarget: string | null = null;
      try {
        ownedTarget = ownerTargetKey(roleId);
      } catch {
        ownedTarget = null;
      }
      if (!ownedTarget) {
        issues.push({ kind: "orphan_lock", lockId, targetKey, roleId });
      } else if (ownedTarget !== rawTargetKey) {
        issues.push({
          kind: "wrong_owner",
          lockId,
          targetKey,
          roleId,
          detail: `role owns ${ownedTarget}`,
        });
      }
    }
  } else if (state === "vacant" && roleId) {
    issues.push({ kind: "vacant_with_role", lockId, targetKey, roleId });
  }

  return { valid: issues.length === 0, issues, targetKey, state, roleId, generation };
}

export interface RoleTargetLockAssessment {
  issues: RoleTargetLockIssue[];
  /** Null when the target takes no weekend lock, or no lock document exists. */
  validation: RoleTargetLockValidation | null;
}

/**
 * Target-level assessment: combines the document's own invariants with the
 * target-level `missing_lock` issue. A weekend target that owns a canonical role
 * but has no lock is a legacy bootstrap candidate; an unoccupied target legitimately
 * has no lock document at all.
 */
export function assessRoleTargetLock(
  input: { targetKey: string; lock: unknown | null; canonicalRoleIds: string[] },
  ownerTargetKey: LockOwnerLookup,
): RoleTargetLockAssessment {
  const lockId = roleTargetLockId(input.targetKey);
  // Special (or otherwise non-weekend) targets never take a lock.
  if (!lockId) return { issues: [], validation: null };

  if (input.lock == null) {
    const occupied = Array.isArray(input.canonicalRoleIds) && input.canonicalRoleIds.length > 0;
    return {
      issues: occupied
        ? [{ kind: "missing_lock", lockId, targetKey: input.targetKey }]
        : [],
      validation: null,
    };
  }

  const validation = validateRoleTargetLock(input.lock, ownerTargetKey);
  return { issues: validation.issues, validation };
}

export interface RoleTargetLockDocument {
  _id: string;
  _type: typeof ROLE_TARGET_LOCK_TYPE;
  targetKey: string;
  state: RoleTargetLockState;
  roleId: string;
  roleType: LockableRoleType;
  date: string;
  claimNonce: string;
  generation: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Document shape for a first claim of a weekend target. Returns null when the
 * target takes no weekend lock or the inputs are unusable — a caller must never
 * write a half-derived lock.
 */
export function buildClaimedLock(input: {
  targetKey: string;
  roleId: string;
  claimNonce: string;
  now: string;
}): RoleTargetLockDocument | null {
  const parsed = parseWeekendTarget(input.targetKey);
  const _id = roleTargetLockId(input.targetKey);
  if (!parsed || !_id) return null;
  if (!nonEmptyString(input.roleId) || !nonEmptyString(input.claimNonce) || !nonEmptyString(input.now)) {
    return null;
  }
  return {
    _id,
    _type: ROLE_TARGET_LOCK_TYPE,
    targetKey: input.targetKey,
    state: "claimed",
    roleId: input.roleId,
    roleType: parsed.roleType,
    date: parsed.date,
    claimNonce: input.claimNonce,
    generation: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export interface LockPatch {
  set: Record<string, unknown>;
  unset: string[];
}

/**
 * Re-claim an existing VACANT lock. The generation is not advanced here: it
 * advances on vacate, so a claim always observes the generation it guarded.
 */
export function claimLockPatch(input: { roleId: string; claimNonce: string; now: string }): LockPatch {
  return {
    set: {
      state: "claimed",
      roleId: input.roleId,
      claimNonce: input.claimNonce,
      updatedAt: input.now,
    },
    unset: [],
  };
}

/**
 * Vacate a claimed lock: deletion/move vacates rather than deletes, clears the
 * owner, and advances the generation so a stale claimant can never be confused
 * with the next one. A missing/invalid stored generation restarts at 1.
 */
export function vacateLockPatch(input: { generation: number | null; now: string }): LockPatch {
  const current =
    typeof input.generation === "number" && Number.isInteger(input.generation) && input.generation >= 0
      ? input.generation
      : 0;
  return {
    set: { state: "vacant", generation: current + 1, updatedAt: input.now },
    unset: ["roleId", "claimNonce"],
  };
}
