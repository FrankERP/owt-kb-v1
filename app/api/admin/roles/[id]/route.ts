import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { randomUUID } from "node:crypto";
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import {
  notifyRoleAssignments,
  revalidateRoleMutation,
  roleUpdateNotice,
} from "@/app/utils/serviceMutationSideEffects";
import { serviceDependencyError, serviceError } from "@/app/utils/serviceMutation";
import { validateRole } from "@/app/utils/serviceReadModel";
import { retireReceiptPatch } from "@/app/utils/roleCreationReceipt";
import {
  buildClaimedLock,
  claimLockPatch,
  roleTargetLockId,
  vacateLockPatch,
} from "@/app/utils/roleTargetLock";
import {
  buildRoleEditPatch,
  parseDeleteRequest,
  parseEditRequest,
  planOwnedLock,
  planTargetClaim,
  roleDateField,
  sanityConflictKind,
} from "@/app/utils/roleWriteRequest";
import {
  bootstrapLegacyLock,
  loadCanonicalRole,
  loadDependencies,
  loadLock,
  loadReceiptsForRole,
  loadRoleForWrite,
  loadTargetOccupancy,
  nextKey,
  nowIso,
  type RoleWriteTarget,
  type StoredLock,
} from "@/app/utils/roleWriteOps";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Guard the session for both handlers. Returns a response when denied. */
async function denyUnlessManager(): Promise<NextResponse | null> {
  const session = await requireActiveManager();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

type LoadOutcome =
  | { ok: true; target: RoleWriteTarget }
  | { ok: false; response: NextResponse };

/**
 * Resolve the stored role, its canonical target, and its coordination token, and
 * assert the revision the client observed. Ambiguity, a raw draft overlay, and a
 * structurally invalid role all fail closed before any write. The rules live in
 * the shared `loadRoleForWrite` so every protected role writer refuses the same
 * states; this only wraps the rejection in a response.
 */
async function loadRoleForMutation(id: string, rev: string): Promise<LoadOutcome> {
  const loaded = await loadRoleForWrite(id, rev);
  if (loaded.ok) return { ok: true, target: loaded.target };
  return {
    ok: false,
    response: reject(serviceError(loaded.failure.code, { details: loaded.failure.details })),
  };
}

/**
 * Edit one service role (A2 §2).
 *
 * Old type/target come from the STORED role — a request `_type` never converts a
 * document. The client-observed role revision is required, the owned weekend lock
 * is asserted in the same transaction, and a permitted date move atomically
 * vacates the old lock and claims/reclaims the new one. Wrong owner, duplicate
 * target, raw draft, dependency, stale role/lock, or destination conflict returns
 * `409` with no business mutation.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await denyUnlessManager();
  if (denied) return denied;

  const { id } = await params;
  const body = await readJson(req);
  const parsed = parseEditRequest(body);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;

  const loaded = await loadRoleForMutation(id, request.rev);
  if (!loaded.ok) return loaded.response;
  let role = loaded.target.role;
  const { targetKey, lockId } = loaded.target;
  const oldDate = loaded.target.date;

  // Whitelist the stored types this route may mutate, and treat the STORED type
  // as authoritative: a request naming a different type is a stale or wrong view,
  // never a conversion (`_type` is immutable per document id).
  const MUTABLE_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;
  const roleType = role._type;
  if (!(MUTABLE_TYPES as readonly string[]).includes(roleType)) {
    return reject(serviceError("invalid_request", { details: { issues: ["_type"] } }));
  }
  if (request.requestedType && request.requestedType !== roleType) {
    return reject(
      serviceError("integrity_conflict", {
        details: { id, storedType: roleType, requestedType: request.requestedType },
      }),
    );
  }

  const newDate = request.date;
  const isMove = newDate !== oldDate;

  // ── Dependency refusal (a move only; a same-date edit touches no history) ──
  if (isMove) {
    const dependencies = await loadDependencies({ operation: "move", role, newDate });
    if (!dependencies.usable) {
      return reject(
        serviceError("integrity_conflict", { details: { dependencyIssues: dependencies.issues } }),
      );
    }
    if (dependencies.hasDependencies) {
      return reject(serviceDependencyError(dependencies.code, dependencies.dependencies));
    }
    const destination = await loadTargetOccupancy({
      roleType,
      date: newDate,
      serviceName: request.serviceName,
      excludeRoleId: role._id,
    });
    if (destination.rawDraftIds.length) {
      return reject(
        serviceError("integrity_conflict", {
          details: { destinationDate: newDate, rawDrafts: destination.rawDraftIds },
        }),
      );
    }
    if (destination.canonicalRoleIds.length) {
      return reject(
        serviceError("ambiguous_target", {
          message: "Ya existe un servicio en la fecha destino.",
          details: { destinationDate: newDate, roleIds: destination.canonicalRoleIds },
        }),
      );
    }
  }

  // ── Coordination: assert the owned lock, bootstrapping a legacy one first ──
  let ownedLock: StoredLock | null = null;
  let bootstrapped = false;
  if (lockId) {
    ownedLock = await loadLock(lockId);
    if (request.lockRev && ownedLock && ownedLock._rev !== request.lockRev) {
      return reject(
        serviceError("stale_revision", {
          details: { lockId, storedRev: ownedLock._rev, observedRev: request.lockRev },
        }),
      );
    }
    const plan = planOwnedLock({ lock: ownedLock, targetKey, roleId: role._id });
    if (plan.kind === "integrity") {
      return reject(
        serviceError("integrity_conflict", { details: { lockId, detail: plan.detail } }),
      );
    }
    if (plan.kind === "bootstrap") {
      const boot = await bootstrapLegacyLock({
        roleId: role._id,
        roleRev: role._rev,
        targetKey,
        dateField: roleDateField(roleType),
        date: oldDate,
      });
      if (!boot.ok || !boot.role || !boot.lock) {
        return reject(
          serviceError(boot.committed ? "bootstrap_completed_reload" : "stale_revision", {
            details: { id, lockId },
          }),
        );
      }
      bootstrapped = true;
      // Continue ONLY from the revisions the maintenance transaction produced.
      role = boot.role;
      ownedLock = boot.lock;
    }
  }

  const now = nowIso();
  const setPayload = buildRoleEditPatch({
    roleType,
    date: newDate,
    serviceName: request.serviceName,
    seats: request.seats,
    nextKey,
  });

  let tx = writeClient
    .transaction()
    .patch(role._id, (p) => p.ifRevisionId(role._rev).set(setPayload));

  if (ownedLock) {
    const lockRev = ownedLock._rev;
    if (isMove) {
      // Vacate the old target, then claim/reclaim the destination — atomically.
      const vacate = vacateLockPatch({ generation: ownedLock.generation ?? null, now });
      tx = tx.patch(ownedLock._id, (p) =>
        p.ifRevisionId(lockRev).set(vacate.set).unset(vacate.unset),
      );
      const destinationKey = `${roleType}:${newDate}`;
      const destinationLock = await loadLock(roleTargetLockId(destinationKey));
      const claim = planTargetClaim({ lock: destinationLock, targetKey: destinationKey });
      if (claim.kind === "integrity" || claim.kind === "occupied") {
        return reject(
          serviceError(claim.kind === "occupied" ? "ambiguous_target" : "integrity_conflict", {
            details: {
              destinationKey,
              detail: claim.kind === "occupied" ? "destination_lock_claimed" : claim.detail,
            },
          }),
        );
      }
      if (claim.kind === "create") {
        const created = buildClaimedLock({
          targetKey: destinationKey,
          roleId: role._id,
          claimNonce: randomUUID(),
          now,
        });
        if (!created) {
          return reject(
            serviceError("integrity_conflict", { details: { detail: "lock_build", destinationKey } }),
          );
        }
        tx = tx.create(created);
      } else {
        const patch = claimLockPatch({ roleId: role._id, claimNonce: randomUUID(), now });
        tx = tx.patch(claim.lockId, (p) => p.ifRevisionId(claim.lockRev).set(patch.set));
      }
    } else {
      // Same target: heartbeat the owned token under its observed revision.
      tx = tx.patch(ownedLock._id, (p) => p.ifRevisionId(lockRev).set({ updatedAt: now }));
    }
  }

  try {
    await tx.commit();
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    return reject(
      serviceError(bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
        details: { id, targetKey },
      }),
    );
  }

  // ── Post-commit side effects (§7), all through the one shared module ───────
  // Recipients derive from committed server state across all five seat paths:
  // the previously stored assignees versus the seats just written. A draft edit
  // stays silent; published or grandfathered notifies only the newly added.
  notifyRoleAssignments([
    roleUpdateNotice({
      published: role.published,
      beforeAssignees: validateRole(role).assignedRefs,
      after: request.seats,
      type: roleType,
      date: newDate,
    }),
  ]);

  revalidateRoleMutation();

  // ── Response: the REFRESHED stored read, at the COMMITTED revision ────────
  // An echo of the request would leave the caller holding the revision it
  // observed BEFORE this write, so its next edit would necessarily be stale —
  // the client would have to refetch to keep editing at all, and a refetch that
  // fails silently downgrades to a guaranteed `409` on the next save. So the
  // committed revision is part of the success response, read back from the
  // canonical contract rather than assembled from the request.
  //
  // The refresh is BEST EFFORT: the business transaction already committed, and
  // a committed mutation is never reported as a failure because a follow-up
  // read did not resolve. When it cannot be resolved unambiguously the response
  // degrades to the identity-only shape it has always had.
  let refreshed: Record<string, unknown> | null = null;
  try {
    const after = await loadCanonicalRole(role._id);
    if (after.state === "single" && after.role && !after.draftIds.length) {
      refreshed = after.role as unknown as Record<string, unknown>;
    }
  } catch {
    refreshed = null;
  }
  return NextResponse.json({
    ...(refreshed ?? {}),
    _id: role._id,
    _type: roleType,
    date: newDate,
    ok: true,
  });
}

/**
 * Delete one service role (A2 §2/§3).
 *
 * Requires the client-observed role revision. The dependency-refusal policy runs
 * BEFORE any coordination maintenance; the business transaction then vacates an
 * owned weekend token, retires a receipt-backed creation key, and deletes the
 * role — atomically. A token owned by another role is never vacated.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await denyUnlessManager();
  if (denied) return denied;

  const { id } = await params;
  const parsed = parseDeleteRequest(await readJson(req));
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;

  const loaded = await loadRoleForMutation(id, request.rev);
  if (!loaded.ok) return loaded.response;
  let role = loaded.target.role;
  const { targetKey, lockId, date } = loaded.target;
  const dateField = roleDateField(role._type);

  // ── Dependency refusal, BEFORE any maintenance write ──────────────────────
  const dependencies = await loadDependencies({ operation: "delete", role });
  if (!dependencies.usable) {
    return reject(
      serviceError("integrity_conflict", { details: { dependencyIssues: dependencies.issues } }),
    );
  }
  if (dependencies.hasDependencies) {
    return reject(serviceDependencyError(dependencies.code, dependencies.dependencies));
  }

  // ── Coordination token: only ever vacate a token this role owns ───────────
  let ownedLock: StoredLock | null = null;
  let bootstrapped = false;
  if (lockId) {
    ownedLock = await loadLock(lockId);
    if (request.lockRev && ownedLock && ownedLock._rev !== request.lockRev) {
      return reject(
        serviceError("stale_revision", {
          details: { lockId, storedRev: ownedLock._rev, observedRev: request.lockRev },
        }),
      );
    }
    const plan = planOwnedLock({ lock: ownedLock, targetKey, roleId: role._id });
    if (plan.kind === "integrity") {
      return reject(
        serviceError("integrity_conflict", { details: { lockId, detail: plan.detail } }),
      );
    }
    if (plan.kind === "bootstrap") {
      const boot = await bootstrapLegacyLock({
        roleId: role._id,
        roleRev: role._rev,
        targetKey,
        dateField,
        date,
      });
      if (!boot.ok || !boot.role || !boot.lock) {
        return reject(
          serviceError(boot.committed ? "bootstrap_completed_reload" : "stale_revision", {
            details: { id, lockId },
          }),
        );
      }
      bootstrapped = true;
      role = boot.role;
      ownedLock = boot.lock;
    }
  }

  // ── Receipt-backed key retirement (a durable idempotency tombstone) ───────
  const receipts = await loadReceiptsForRole(role._id);
  if (receipts.length > 1) {
    return reject(
      serviceError("integrity_conflict", {
        details: { id, receiptIds: receipts.map((r) => r._id), detail: "multiple_receipts" },
      }),
    );
  }
  const receipt = receipts[0] ?? null;
  if (receipt && receipt.roleId !== role._id) {
    return reject(
      serviceError("integrity_conflict", {
        details: { id, receiptId: receipt._id, detail: "receipt_owner_mismatch" },
      }),
    );
  }
  if (role.creationReceiptId && receipt && role.creationReceiptId !== receipt._id) {
    return reject(
      serviceError("integrity_conflict", {
        details: { id, receiptId: receipt._id, detail: "receipt_link_mismatch" },
      }),
    );
  }

  const now = nowIso();
  let tx = writeClient.transaction();
  if (ownedLock) {
    const vacate = vacateLockPatch({ generation: ownedLock.generation ?? null, now });
    const lockRev = ownedLock._rev;
    tx = tx.patch(ownedLock._id, (p) =>
      p.ifRevisionId(lockRev).set(vacate.set).unset(vacate.unset),
    );
  }
  if (receipt) {
    const retire = retireReceiptPatch({ now });
    const receiptRev = receipt._rev;
    tx = tx.patch(receipt._id, (p) => p.ifRevisionId(receiptRev).set(retire.set));
  }
  // `delete` takes no revision precondition, so the guarded shape is a
  // revision-asserting no-op heartbeat of the unchanged date field in the same
  // transaction: a moved role revision rolls the whole delete back.
  const roleRev = role._rev;
  tx = tx
    .patch(role._id, (p) => p.ifRevisionId(roleRev).set({ [dateField]: date }))
    .delete(role._id);

  try {
    await tx.commit();
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    return reject(
      serviceError(bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
        details: { id, targetKey },
      }),
    );
  }

  // A removal is silent by §7: only the caches are refreshed, nobody is notified.
  revalidateRoleMutation();
  return NextResponse.json({ ok: true, id: role._id });
}
