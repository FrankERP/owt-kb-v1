// The service-create writer (Service Readiness A2 §2) — the domain body of
// `POST /api/admin/roles`, moved here VERBATIM so the MCP `apply_schedule` tool
// creates its drafts through the very same code path (MCP P4, D4). The admin route
// keeps only its run-context wrapper, its authorization prefix and its JSON parse;
// it cannot export this function itself, because Next type-checks a route module's
// export set against a fixed list.
//
// The deterministic `roleCreationReceipt` is the global create-request mutex
// across every role type and target; the weekend `roleTargetLock` independently
// serializes DIFFERENT request ids competing for one weekend target. A lost
// response replays as idempotent success with no writes, notifications, or
// revalidation; the same key with a different payload is `409
// idempotency_mismatch`, and a retired key can never recreate its role.
//
// Boundary, and nothing else, differs from the route it came from: each refusal
// RETURNS `{ ok: false, status, body }` instead of sending it, success returns the
// same JSON as `body` (201 on a create, 200 on a replay) plus `effects`, and the
// two post-commit helpers' return values (their descriptors) are captured at their
// existing call sites. A commit that fails for any reason other than a
// revision/creation conflict still THROWS, exactly as the route's 500 did.
//
// `body` is the parsed JSON exactly as the route's `req.json()` hands it: the
// receipt fingerprints that payload, so a caller that builds the body itself
// passes it through `JSON.parse(JSON.stringify(…))` first.
//
// This module is a registered protected writer (`PROTECTED_RUNTIME_WRITERS`,
// `app/utils/roleCreateCommit.ts#module`), its callers are pinned by
// `serviceCommitCallers.test.ts`, and it is a delivery-capable import for the
// SR-verification run-context scan. Adding a caller means touching that pin.
// Why the writers live here and not in their routes: ADR-0043.

import "server-only";

import { randomUUID } from "node:crypto";
import { writeClient } from "@/sanity/lib/serverClient";
import {
  notifyRoleAssignments,
  queueRoleNotices,
  revalidateRoleMutation,
  roleCreateNotice,
  type RoleAssignmentPushDescriptor,
  type RoleNoticesDescriptor,
} from "@/app/utils/serviceMutationSideEffects";
import { serviceDependencyError, serviceError } from "@/app/utils/serviceMutation";
import { buildCreationReceipt } from "@/app/utils/roleCreationReceipt";
import { buildClaimedLock, claimLockPatch } from "@/app/utils/roleTargetLock";
import {
  loadSpecialIdentityCoordinator,
  planSpecialIdentityCoordinatorClaim,
} from "@/app/utils/specialIdentityCoordinator";
import {
  buildRoleDocument,
  decideReceipt,
  parseCreateRequest,
  planTargetClaim,
  sanityConflictKind,
  seatAssignees,
  type ParsedCreateRequest,
} from "@/app/utils/roleWriteRequest";
import {
  clashInputsOf,
  loadCanonicalMembers,
  loadCanonicalRole,
  loadDependencies,
  loadLock,
  loadReceiptById,
  loadTargetOccupancy,
  nextKey,
  nowIso,
  type StoredReceipt,
} from "@/app/utils/roleWriteOps";
import { addedSeatClashes, seatClashErrorDetails } from "@/app/utils/seatClashGuard";
import type { CommitOutcome } from "@/app/utils/commitOutcome";

/**
 * What a create already held, for a caller that must report it. Nothing here is
 * re-read after the commit. A replay wrote nothing and queued nothing.
 */
export type RoleCreateEffects =
  | { kind: "replay"; roleId: string | null }
  | {
      kind: "created";
      roleId: string;
      /** `notifyRoleAssignments`' descriptor (a draft create notifies nobody). */
      push: RoleAssignmentPushDescriptor;
      /** `queueRoleNotices`' descriptor; null when it queued nothing. */
      notice: RoleNoticesDescriptor | null;
    };

function refuse(res: { status: number; body: unknown }): { ok: false; status: number; body: Record<string, unknown> } {
  return { ok: false, status: res.status, body: res.body as Record<string, unknown> };
}

/** Create one service role (A2 §2). `body` is the request's parsed JSON. */
export async function createRole(body: unknown): Promise<CommitOutcome<RoleCreateEffects, 200 | 201>> {
  const parsed = parseCreateRequest(body);
  if (!parsed.ok) {
    return refuse(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;

  // Whitelist the service doc types this route may create — never trust an
  // arbitrary caller-supplied _type into a create transaction.
  const ALLOWED_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;
  if (!(ALLOWED_TYPES as readonly string[]).includes(request.roleType)) {
    return refuse(serviceError("invalid_request", { details: { issues: ["_type"] } }));
  }

  // ── Existing receipt: lost-response replay, mismatch, or retired key ──────
  const existing = await loadReceiptById(request.receiptId);
  if (existing) {
    return resolveExistingReceipt(existing, request);
  }

  // A first attempt may write only published-perspective canonical members.
  // Exact receipt replay stays above this lookup so idempotency does not depend
  // on whether a previously committed assignee still exists today.
  const wanted = seatAssignees(request.seats);
  const members = await loadCanonicalMembers(wanted);
  const resolvedMembers = new Set(members.keys());
  const danglingRefs = wanted.filter((id) => !resolvedMembers.has(id)).sort();
  if (danglingRefs.length) {
    return refuse(serviceError("integrity_conflict", { details: { danglingRefs } }));
  }
  // No pair of seats one person may not hold on one service (ADR-0078). Below
  // the receipt replay on purpose: an already-committed create is never refused
  // by a rule that did not exist when it committed.
  const { singsAndPlays, names } = clashInputsOf(members);
  const clashes = addedSeatClashes(null, request.seats, singsAndPlays);
  if (clashes.length) {
    return refuse(serviceError("invalid_request", { details: seatClashErrorDetails(clashes, names) }));
  }

  // ── First attempt: inventory the target before writing anything ───────────
  const occupancy = await loadTargetOccupancy({
    roleType: request.roleType,
    date: request.date,
    serviceName: request.serviceName,
  });
  if (occupancy.rawDraftIds.length) {
    return refuse(
      serviceError("integrity_conflict", {
        details: { targetKey: request.targetKey, rawDrafts: occupancy.rawDraftIds },
      }),
    );
  }
  if (occupancy.canonicalRoleIds.length) {
    return refuse(
      serviceError("ambiguous_target", {
        message: "Ya existe un servicio en esta fecha para este tipo.",
        details: { targetKey: request.targetKey, roleIds: occupancy.canonicalRoleIds },
      }),
    );
  }

  const dependencies = await loadDependencies({
    operation: "create",
    target: { roleType: request.roleType, date: request.date },
  });
  if (!dependencies.usable) {
    return refuse(
      serviceError("integrity_conflict", { details: { dependencyIssues: dependencies.issues } }),
    );
  }
  if (dependencies.hasDependencies) {
    return refuse(serviceDependencyError(dependencies.code, dependencies.dependencies));
  }

  // ── Weekend lock plan (special services take no lock) ─────────────────────
  const lock = await loadLock(request.lockId);
  let claim: ReturnType<typeof planTargetClaim> | null = null;
  if (request.lockId) {
    claim = planTargetClaim({
      lock,
      targetKey: `${request.roleType}:${request.date}`,
      ownerExists: undefined,
    });
    if (claim.kind === "integrity") {
      return refuse(
        serviceError("integrity_conflict", {
          details: { lockId: request.lockId, detail: claim.detail },
        }),
      );
    }
    if (claim.kind === "occupied") {
      // The canonical target was proven empty above, so a still-claimed lock is
      // a wrong-owner/orphan integrity issue. It is never reclaimed implicitly.
      return refuse(
        serviceError("integrity_conflict", {
          details: {
            lockId: request.lockId,
            ownerRoleId: claim.roleId,
            detail: "lock_claimed_without_canonical_owner",
          },
        }),
      );
    }
  }

  const roleId = randomUUID();
  const now = nowIso();
  const receipt = buildCreationReceipt({
    requestId: request.requestId,
    payload: body as Parameters<typeof buildCreationReceipt>[0]["payload"],
    roleId,
    now,
  });
  if (!receipt) {
    return refuse(serviceError("invalid_request", { details: { issues: ["receipt"] } }));
  }
  const doc = buildRoleDocument({
    roleId,
    roleType: request.roleType,
    date: request.date,
    serviceName: request.serviceName,
    time: request.time,
    format: request.format,
    published: request.published,
    countsForFairness: request.countsForFairness,
    seats: request.seats,
    receiptId: request.receiptId,
    fingerprint: request.fingerprint,
    nextKey,
  });

  let specialClaim: ReturnType<typeof planSpecialIdentityCoordinatorClaim> | null = null;
  if (request.roleType === "special_role") {
    const loadedCoordinator = await loadSpecialIdentityCoordinator();
    if (!loadedCoordinator.ok) {
      return refuse(
        serviceError("integrity_conflict", {
          details: { detail: "special_identity_coordinator", issues: loadedCoordinator.issues },
        }),
      );
    }
    specialClaim = planSpecialIdentityCoordinatorClaim(loadedCoordinator.coordinator);
    if (!specialClaim.ok) {
      return refuse(
        serviceError("integrity_conflict", {
          details: { detail: "special_identity_coordinator", issues: specialClaim.issues },
        }),
      );
    }
  }

  // One transaction: receipt + role (+ weekend claim or special coordinator).
  // `create`, never
  // `createIfNotExists` — the id collision IS the cross-request mutex.
  let tx = writeClient.transaction().create(receipt).create(doc);
  if (claim?.kind === "create") {
    const lockDoc = buildClaimedLock({
      targetKey: `${request.roleType}:${request.date}`,
      roleId,
      claimNonce: randomUUID(),
      now,
    });
    if (!lockDoc) {
      return refuse(serviceError("integrity_conflict", { details: { detail: "lock_build" } }));
    }
    tx = tx.create(lockDoc);
  } else if (claim?.kind === "reclaim") {
    const patch = claimLockPatch({ roleId, claimNonce: randomUUID(), now });
    tx = tx.patch(claim.lockId, (p) => p.ifRevisionId(claim.lockRev).set(patch.set));
  } else if (specialClaim?.ok && specialClaim.kind === "create") {
    tx = tx.create(specialClaim.document);
  } else if (specialClaim?.ok && specialClaim.kind === "patch") {
    tx = tx.patch(specialClaim.id, (p) =>
      p.ifRevisionId(specialClaim.ifRevisionId).set(specialClaim.set),
    );
  }

  try {
    await tx.commit();
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    // Never blindly retry: refetch the RECEIPT first, so a same-key winner is
    // reported as replay/mismatch rather than as a target conflict.
    const raced = await loadReceiptById(request.receiptId);
    if (raced) return resolveExistingReceipt(raced, request);
    const afterStatePromise = loadTargetOccupancy({
      roleType: request.roleType,
      date: request.date,
      serviceName: request.serviceName,
    });
    const coordinatorPromise =
      request.roleType === "special_role" ? loadSpecialIdentityCoordinator() : Promise.resolve(null);
    const [afterState, coordinatorAfter] = await Promise.all([
      afterStatePromise,
      coordinatorPromise,
    ]);
    if (afterState.rawDraftIds.length) {
      return refuse(
        serviceError("integrity_conflict", {
          details: { targetKey: request.targetKey, rawDrafts: afterState.rawDraftIds },
        }),
      );
    }
    if (afterState.canonicalRoleIds.length) {
      return refuse(
        serviceError("ambiguous_target", {
          details: { targetKey: request.targetKey, roleIds: afterState.canonicalRoleIds },
        }),
      );
    }
    if (coordinatorAfter && !coordinatorAfter.ok) {
      return refuse(
        serviceError("integrity_conflict", {
          details: { detail: "special_identity_coordinator", issues: coordinatorAfter.issues },
        }),
      );
    }
    return refuse(
      serviceError("stale_revision", {
        details: {
          targetKey: request.targetKey,
          ...(coordinatorAfter?.ok && coordinatorAfter.coordinator
            ? {
                coordinatorRev: coordinatorAfter.coordinator._rev,
                coordinatorVersion: coordinatorAfter.coordinator.version,
              }
            : {}),
        },
      }),
    );
  }

  // ── Post-commit side effects (§7), all through the one shared module ───────
  // ISR invalidation: a newly created service must appear on the schedule/home
  // and /me views immediately. Drafts still revalidate — they surface in the
  // admin (Editar) views.
  revalidateRoleMutation();
  // Recipients derive from the seats actually committed, across all five paths;
  // a draft create stays silent.
  const push = notifyRoleAssignments([
    roleCreateNotice({
      published: request.published,
      seats: request.seats,
      type: request.roleType,
      date: request.date,
    }),
  ]);
  // The debounced email (§2). Creating an already-published service QUEUES
  // rather than emailing immediately, with no carve-out for creation: admins
  // routinely create a service and then adjust it, and a carve-out would produce
  // exactly the "asignado now, cambió later" double email this exists to
  // prevent. There is no before-state — the role did not exist a moment ago.
  const notice = queueRoleNotices({
    roleId,
    roleType: request.roleType,
    serviceDate: request.date,
    published: request.published,
    beforeSeats: null,
    afterSeats: request.seats,
  });

  return {
    ok: true,
    status: 201,
    body: { ...doc, creationRequestId: request.requestId },
    effects: { kind: "created", roleId, push, notice },
  };
}


/**
 * Apply the §2 receipt rules to an existing receipt at this request's
 * deterministic id. A replay returns the committed role with NO writes,
 * notifications, or revalidation.
 */
async function resolveExistingReceipt(
  receipt: StoredReceipt,
  request: ParsedCreateRequest,
): Promise<CommitOutcome<RoleCreateEffects, 200 | 201>> {
  const roleId = typeof receipt.roleId === "string" ? receipt.roleId : null;
  const lookup = roleId ? await loadCanonicalRole(roleId) : null;
  const decision = decideReceipt({
    receipt,
    requestId: request.requestId,
    fingerprint: request.fingerprint,
    role: lookup?.role ?? null,
  });
  if (decision.decision === "replay") {
    return {
      ok: true,
      status: 200,
      body: { ...(lookup?.role as object), replay: true, creationRequestId: request.requestId },
      effects: { kind: "replay", roleId },
    };
  }
  if (decision.decision === "absent") {
    // Cannot happen (the receipt was fetched), but fail closed rather than
    // falling through into a second create.
    return refuse(serviceError("integrity_conflict", { details: { detail: "receipt_vanished" } }));
  }
  return refuse(
    serviceError(decision.decision, {
      details: { receiptId: request.receiptId, roleId, detail: decision.detail },
    }),
  );
}
