// Server-side target resolution shared by the protected live-setlist writer
// (Service Readiness A2 §5) and the protected proposal writers (§6).
//
// Every canonical read goes through A1's canonical operational clients and A1's
// bound query builders — there is no ad-hoc GROQ here, and no arbitrary `[0]`
// pick. Business transactions stay in their route handlers; this module only
// resolves state and reports the exact rejection a route turns into a
// `serviceError(...)`.
//
// `server-only` keeps the tokened clients out of any client bundle.

import "server-only";

import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import {
  canonicalProposalByIdQuery,
  canonicalSetlistsForTargetQuery,
  canonicalWeekendRolesForTargetQuery,
  proposalsForRoleOrDatesQuery,
  rawProposalDraftForBaseQuery,
  rawProposalDraftsForRoleOrDatesQuery,
  rawRoleDraftsForTargetQuery,
  rawSetlistDraftsForWeekQuery,
} from "@/app/utils/serviceReadQueries";
import {
  indexProposals,
  proposalTargetKey,
  validateProposal,
  validateRole,
  type ProposalValidation,
  type RoleType,
} from "./serviceReadModel";
import { pickUnique } from "./serviceReadSelect";
import { roleTargetLockId } from "./roleTargetLock";
import { storedRoleDate } from "./roleWriteRequest";
import {
  loadCanonicalRole,
  loadCanonicalRolesByIds,
  resolveOwnedCoordination,
  type RoleWriteFailure,
  type StoredLock,
  type StoredRole,
} from "./roleWriteOps";
import type { ServerTarget, WeekendSetlistType } from "./setlistWriteRequest";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

async function run<T>(bound: { query: string; params: Record<string, unknown> }): Promise<T[]> {
  const rows = await operationalClient.fetch<T[]>(bound.query, bound.params);
  return Array.isArray(rows) ? rows : [];
}

async function runRaw<T>(bound: { query: string; params: Record<string, unknown> }): Promise<T[]> {
  const rows = await rawIntegrityClient.fetch<T[]>(bound.query, bound.params);
  return Array.isArray(rows) ? rows : [];
}

function failure(code: RoleWriteFailure["code"], details: Record<string, unknown>): {
  ok: false;
  failure: RoleWriteFailure;
} {
  return { ok: false, failure: { code, details } };
}

function idsOf(rows: unknown[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const id = isObj(row) ? row._id : null;
    if (nonEmptyString(id)) out.push(id);
  }
  return out;
}

// ── Live setlist target ─────────────────────────────────────────────────────

export interface SetlistTargetState {
  /** Canonically resolved singleton/absence of the live setlist target. */
  server: ServerTarget;
  /** The stored setlist document, when the target resolves to exactly one. */
  record: Record<string, unknown> | null;
}

export type SetlistTargetLoad =
  | { ok: true; target: SetlistTargetState }
  | { ok: false; failure: RoleWriteFailure };

/**
 * Resolve ONE weekend live-setlist target (`featuredSongs`/`saturdarSongs` +
 * `week`). A raw `drafts.*` overlay for the same target, a malformed identity, or
 * a duplicate group all fail closed BEFORE any write: a setlist is never written
 * into an ambiguous target and a draft is never adopted.
 */
export async function loadWeekendSetlistTarget(
  setlistType: WeekendSetlistType,
  week: string,
): Promise<SetlistTargetLoad> {
  const [canonical, drafts] = await Promise.all([
    run<Record<string, unknown>>(canonicalSetlistsForTargetQuery(setlistType, week)),
    runRaw<{ _id: string }>(rawSetlistDraftsForWeekQuery(setlistType, week)),
  ]);
  if (drafts.length) {
    return failure("integrity_conflict", {
      setlistType,
      week,
      rawDrafts: idsOf(drafts),
      detail: "setlist_draft_conflict",
    });
  }
  if (canonical.some((row) => !nonEmptyString(row._id) || !nonEmptyString(row._rev))) {
    return failure("integrity_conflict", { setlistType, week, detail: "setlist_malformed" });
  }
  if (canonical.length > 1) {
    return failure("ambiguous_target", {
      setlistType,
      week,
      conflictingIds: idsOf(canonical),
    });
  }
  const record = pickUnique(canonical);
  return {
    ok: true,
    target: record
      ? { server: { state: "single", id: record._id as string, rev: record._rev as string }, record }
      : { server: { state: "none" }, record: null },
  };
}

export interface SpecialSetlistTarget extends SetlistTargetState {
  role: StoredRole;
}

export type SpecialSetlistTargetLoad =
  | { ok: true; target: SpecialSetlistTarget }
  | { ok: false; failure: RoleWriteFailure };

/**
 * Resolve a special service's setlist target: the `special_role` document itself
 * carries the songs, so resolving it validates request identity AND the target.
 * A stored `songs` field is a `single` target; an absent field is `none` (the
 * service has no setlist yet) — exactly the distinction A1's GET reports.
 */
export async function loadSpecialSetlistTarget(
  roleId: string,
  serviceDate: string,
): Promise<SpecialSetlistTargetLoad> {
  const lookup = await loadCanonicalRole(roleId);
  if (lookup.state === "none") return failure("not_found", { roleId });
  if (lookup.state !== "single" || !lookup.role) {
    return failure("ambiguous_target", { roleId, state: lookup.state });
  }
  if (lookup.draftIds.length) {
    return failure("integrity_conflict", { roleId, rawDrafts: lookup.draftIds });
  }
  const role = lookup.role;
  if (role._type !== "special_role") {
    return failure("invalid_request", { roleId, issues: ["_type"] });
  }
  if (!validateRole(role).groupable) {
    return failure("integrity_conflict", { roleId, detail: "role_malformed" });
  }
  if (storedRoleDate(role) !== serviceDate) {
    return failure("invalid_request", { roleId, issues: ["week"] });
  }
  const hasSongs = Array.isArray(role.songs);
  return {
    ok: true,
    target: {
      role,
      record: hasSongs ? (role as unknown as Record<string, unknown>) : null,
      server: hasSongs ? { state: "single", id: role._id, rev: role._rev } : { state: "none" },
    },
  };
}

// ── Weekend coordination (the owned target lock) ────────────────────────────

export interface WeekendCoordination {
  /** The canonical service role owning this weekend target, when one exists. */
  role: StoredRole | null;
  /** The owned coordination token to assert/heartbeat; null when no role exists. */
  lock: StoredLock | null;
  /** Compatibility marker; bootstrap maintenance now always returns a failure. */
  bootstrapped: false;
}

export type WeekendCoordinationLoad =
  | { ok: true; coordination: WeekendCoordination }
  | { ok: false; failure: RoleWriteFailure };

/**
 * Resolve the coordination token every weekend setlist/proposal writer must
 * heartbeat: the `roleTargetLock` owned by the service role at this target.
 *
 * A duplicate role group or a raw role draft at the target fails closed. A target
 * with NO canonical role has no owner and therefore no token — the deterministic
 * setlist/proposal id remains the create mutex, and there is no competing role
 * writer to serialize against.
 */
export async function loadWeekendCoordination(input: {
  roleType: Exclude<RoleType, "special_role">;
  week: string;
}): Promise<WeekendCoordinationLoad> {
  const [roles, drafts] = await Promise.all([
    run<StoredRole>(canonicalWeekendRolesForTargetQuery(input.roleType, input.week)),
    runRaw<{ _id: string }>(rawRoleDraftsForTargetQuery(input.roleType, input.week)),
  ]);
  if (drafts.length) {
    return {
      ...failure("integrity_conflict", {
        roleType: input.roleType,
        week: input.week,
        rawDrafts: idsOf(drafts),
        detail: "role_draft_conflict",
      }),
    };
  }
  if (roles.length > 1) {
    return {
      ...failure("ambiguous_target", {
        roleType: input.roleType,
        week: input.week,
        roleIds: idsOf(roles),
      }),
    };
  }
  const role = pickUnique(roles);
  if (!role) {
    return { ok: true, coordination: { role: null, lock: null, bootstrapped: false } };
  }
  const validation = validateRole(role);
  if (!validation.groupable || !validation.targetKey) {
    return {
      ...failure("integrity_conflict", { roleId: role._id, issues: validation.issues }),
    };
  }
  const date = storedRoleDate(role);
  if (!date) {
    return {
      ...failure("integrity_conflict", { roleId: role._id, issues: ["date"] }),
    };
  }
  const coordination = await resolveOwnedCoordination([
    { role, date, targetKey: validation.targetKey, lockId: roleTargetLockId(validation.targetKey) },
  ]);
  if (!coordination.ok) {
    return { ok: false, failure: coordination.failure };
  }
  const resolved = coordination.roles[0];
  return {
    ok: true,
    coordination: {
      role: resolved.role,
      lock: resolved.lock,
      bootstrapped: false,
    },
  };
}

// ── Proposal grouping through BOTH indexes ─────────────────────────────────

export interface ProposalGroup {
  /** The one shared proposal for this service, or null when there is none. */
  existing: Record<string, unknown> | null;
  /** Validation of `existing` (target key, content state, status). */
  validation: ProposalValidation | null;
}

export type ProposalGroupLoad =
  | { ok: true; group: ProposalGroup }
  | { ok: false; failure: RoleWriteFailure };

/**
 * Resolve the ONE shared proposal for a service through A1's two indexes
 * (`service_ref` and target key) — never an arbitrary `order()[0]`.
 *
 * Fails closed on: a raw `drafts.*` proposal for this service/target, a
 * structurally invalid proposal that names this role (it must not be shadowed by
 * a second one), more than one valid proposal on either index, and two indexes
 * that disagree about which document is the shared proposal.
 */
export async function loadProposalGroup(input: {
  roleId: string;
  serviceDate: string;
  targetKey: string;
}): Promise<ProposalGroupLoad> {
  const [canonical, rawDrafts] = await Promise.all([
    run<Record<string, unknown>>(proposalsForRoleOrDatesQuery(input.roleId, [input.serviceDate])),
    runRaw<Record<string, unknown>>(
      rawProposalDraftsForRoleOrDatesQuery(input.roleId, [input.serviceDate]),
    ),
  ]);

  const relevantDrafts = rawDrafts.filter((row) => {
    if (row.service_ref === input.roleId) return true;
    const key = proposalTargetKey(
      String(row.service_type ?? ""),
      String(row.service_date ?? ""),
      String(row.service_ref ?? ""),
    );
    return key !== null && key === input.targetKey;
  });
  if (relevantDrafts.length) {
    return failure("integrity_conflict", {
      roleId: input.roleId,
      rawDrafts: idsOf(relevantDrafts),
      detail: "proposal_draft_conflict",
    });
  }

  // Resolve every referenced role so a same-target proposal pointing at another
  // (or a missing) role is still validated and still blocks.
  const refs = [
    ...new Set(canonical.map((row) => row.service_ref).filter((r): r is string => nonEmptyString(r))),
  ];
  const roles = await loadCanonicalRolesByIds(refs);
  const rolesById = new Map(roles.map((r) => [r._id, r]));

  const pairs = canonical.map((doc) => ({
    doc,
    validation: validateProposal(
      doc,
      nonEmptyString(doc.service_ref) ? rolesById.get(doc.service_ref) ?? null : null,
    ),
  }));

  const brokenForThisRole = pairs.filter(
    (p) => p.doc.service_ref === input.roleId && !p.validation.valid,
  );
  if (brokenForThisRole.length) {
    return failure("integrity_conflict", {
      roleId: input.roleId,
      proposalIds: idsOf(brokenForThisRole.map((p) => p.doc)),
      issues: [...new Set(brokenForThisRole.flatMap((p) => p.validation.issues))],
      detail: "proposal_malformed",
    });
  }

  const indexes = indexProposals(pairs.map((p) => p.validation));
  const byRef = indexes.byServiceRef.get(input.roleId) ?? [];
  const byKey = indexes.byTargetKey.get(input.targetKey) ?? [];
  if (byRef.length > 1 || byKey.length > 1) {
    return failure("ambiguous_target", {
      roleId: input.roleId,
      targetKey: input.targetKey,
      byServiceRef: byRef.length,
      byTargetKey: byKey.length,
    });
  }
  const chosen = byRef[0] ?? byKey[0] ?? null;
  if (byRef[0] && byKey[0] && byRef[0] !== byKey[0]) {
    return failure("ambiguous_target", {
      roleId: input.roleId,
      targetKey: input.targetKey,
      detail: "index_disagreement",
    });
  }
  if (!chosen) return { ok: true, group: { existing: null, validation: null } };
  const doc = pairs.find((p) => p.validation === chosen)?.doc ?? null;
  if (!doc) {
    return failure("integrity_conflict", { roleId: input.roleId, detail: "proposal_unresolved" });
  }
  return { ok: true, group: { existing: doc, validation: chosen } };
}

export interface CanonicalProposal {
  doc: Record<string, unknown>;
  validation: ProposalValidation;
  role: StoredRole;
}

export type CanonicalProposalLoad =
  | { ok: true; proposal: CanonicalProposal }
  | { ok: false; failure: RoleWriteFailure };

/**
 * Resolve ONE proposal by id together with the canonical role it targets. Zero,
 * many, a raw draft overlay, an unresolved/invalid role, or a structurally
 * invalid proposal all fail closed — an admin transition never acts on a record
 * whose target cannot be authorized.
 *
 * `tolerateIssues` is the ONE narrow exception: the guarded retarget action
 * exists precisely to repair stored target metadata that drifted from its role,
 * so it may load a proposal whose only validation issues are that drift. Any
 * other issue still fails closed.
 */
export async function loadCanonicalProposal(
  id: string,
  tolerateIssues: readonly string[] = [],
): Promise<CanonicalProposalLoad> {
  const [rows, drafts] = await Promise.all([
    run<Record<string, unknown>>(canonicalProposalByIdQuery(id)),
    runRaw<{ _id: string }>(rawProposalDraftForBaseQuery(id)),
  ]);
  if (!rows.length) return failure("not_found", { id });
  if (rows.length > 1) return failure("ambiguous_target", { id, count: rows.length });
  if (drafts.length) {
    return failure("integrity_conflict", { id, rawDrafts: idsOf(drafts), detail: "proposal_draft_conflict" });
  }
  const doc = rows[0];
  const ref = nonEmptyString(doc.service_ref) ? doc.service_ref : null;
  if (!ref) return failure("integrity_conflict", { id, issues: ["service_ref"] });
  const lookup = await loadCanonicalRole(ref);
  if (lookup.state !== "single" || !lookup.role) {
    return failure("integrity_conflict", { id, roleId: ref, detail: "role_unresolved" });
  }
  if (lookup.draftIds.length) {
    return failure("integrity_conflict", { id, roleId: ref, rawDrafts: lookup.draftIds });
  }
  const validation = validateProposal(doc, lookup.role);
  const blocking = validation.issues.filter((issue) => !tolerateIssues.includes(issue));
  if (blocking.length || !validation.targetKey) {
    return failure("integrity_conflict", { id, issues: validation.issues });
  }
  return { ok: true, proposal: { doc, validation, role: lookup.role } };
}
