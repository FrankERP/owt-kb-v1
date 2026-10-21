// The guarded role-edit writer (Service Readiness A2 §2) — the domain body of
// `PATCH /api/admin/roles/[id]`, moved here VERBATIM so the MCP stored-service save
// (`save_service_edits`, admin parity phase 1, T2.1) calls the very same code path.
// The admin route keeps only its authorization prefix, its JSON parse and
// `parseEditRequest`; it cannot export this function itself, because Next
// type-checks a route module's export set against a fixed list.
//
// Old type/target come from the STORED role — a request `_type` never converts a
// document. The client-observed role revision is required, the owned weekend lock
// is asserted in the same transaction, and a permitted date move atomically
// vacates the old lock and claims/reclaims the new one. Wrong owner, duplicate
// target, raw draft, dependency, stale role/lock, or destination conflict returns
// `409` with no business mutation. A request without `lockRev` loads the lock and
// heartbeats it under the revision it read (the MCP save never sends one: a weekend
// setlist save heartbeats that lock, `setlistSaveCommit.ts`).
//
// Boundary, and nothing else, differs from the route it came from: each refusal
// RETURNS `{ ok: false, status, body }` instead of sending it, success returns the
// same JSON as `body` plus `effects`. A commit that fails for any reason other than
// a revision/creation conflict still THROWS, exactly as the route's 500 did.
//
// ONE option, `notices`: `"deferred"` (the route, unchanged) queues the outbox
// notices in `after()` with the opportunistic sweep; `"inline"` (the MCP save)
// awaits the upsert before returning, with no sweep, and reports in
// `effects.noticesQueued` whether it landed (`queueRoleNoticesNow`). The push stays
// in `after()` on both.
//
// This module is a registered protected writer (`PROTECTED_RUNTIME_WRITERS`), its
// callers are pinned by `serviceCommitCallers.test.ts`, and it is a
// delivery-capable import for the SR-verification run-context scan. ADR-0043.

import "server-only";

import { randomUUID } from "node:crypto";
import { writeClient } from "@/sanity/lib/serverClient";
import {
  isNoticeNeutralEdit,
  notifyRoleAssignments,
  queueRoleNotices,
  queueRoleNoticesNow,
  revalidateRoleMutation,
  roleUpdateNotice,
  type RoleAssignmentPushDescriptor,
  type RoleNoticesDescriptor,
} from "@/app/utils/serviceMutationSideEffects";
import { serviceDependencyError, serviceError, type ServiceErrorResponse } from "@/app/utils/serviceMutation";
import { normalizeServiceName } from "@/app/utils/normalizeLabel";
import { validateRole } from "@/app/utils/serviceReadModel";
import {
  loadSpecialIdentityCoordinator,
  planSpecialIdentityCoordinatorClaim,
} from "@/app/utils/specialIdentityCoordinator";
import {
  buildClaimedLock,
  claimLockPatch,
  roleTargetLockId,
  vacateLockPatch,
} from "@/app/utils/roleTargetLock";
import {
  buildRoleEditPatch,
  normalizeStoredSeats,
  planOwnedLock,
  planTargetClaim,
  roleDateField,
  sanityConflictKind,
  seatAssignees,
  type NormalizedSeats,
  type ParsedEditRequest,
} from "@/app/utils/roleWriteRequest";
import {
  bootstrapLegacyLock,
  loadCanonicalMemberIds,
  loadCanonicalRole,
  loadDependencies,
  loadLock,
  loadRoleForWrite,
  loadTargetOccupancy,
  nextKey,
  nowIso,
  type StoredLock,
  type StoredRole,
} from "@/app/utils/roleWriteOps";
import type { CommitOutcome } from "@/app/utils/commitOutcome";

export interface RoleEditOptions {
  /** `"deferred"` (default, the route) or `"inline"` (the MCP save). See the header. */
  notices?: "deferred" | "inline";
}

/** What a committed edit already held, for a caller that must report it. */
export interface RoleEditEffects {
  /** The role exactly as it was loaded, pre-commit. */
  role: StoredRole;
  /** The seats stored before this write (pre-commit) and the seats it wrote. */
  seats: { before: NormalizedSeats; after: NormalizedSeats };
  /** True when the edit changed nothing a notice could report (solver v3 C1 §5.4.4). */
  noticeNeutral: boolean;
  /** `notifyRoleAssignments`' descriptor; null when the edit was notice-neutral. */
  push: RoleAssignmentPushDescriptor | null;
  /** `queueRoleNotices`' descriptor; null when it queued nothing. */
  notices: RoleNoticesDescriptor | null;
  /** Inline mode only: whether the notices landed. `null` in deferred mode or when notice-neutral. */
  noticesQueued: boolean | null;
  /** The committed revision from the refreshed read; `null` when it could not be resolved. */
  committedRev: string | null;
}

const refuse = (res: ServiceErrorResponse) => ({ ok: false as const, ...res });

export async function editRole(
  id: string,
  request: ParsedEditRequest,
  options: RoleEditOptions = {},
): Promise<CommitOutcome<RoleEditEffects>> {
  // Validate the complete submitted roster before any occupancy, coordination,
  // legacy bootstrap, or business transaction can run. This is referential
  // validation only; memberType remains UI guidance, not server policy.
  const wanted = seatAssignees(request.seats);
  const resolvedMembers = await loadCanonicalMemberIds(wanted);
  const danglingRefs = wanted.filter((memberId) => !resolvedMembers.has(memberId)).sort();
  if (danglingRefs.length) {
    return refuse(serviceError("integrity_conflict", { details: { danglingRefs } }));
  }

  // Resolve the stored role, its canonical target, and its coordination token, and
  // assert the revision the client observed. Ambiguity, a raw draft overlay, and a
  // structurally invalid role all fail closed before any write. The rules live in
  // the shared `loadRoleForWrite` so every protected role writer refuses the same
  // states.
  const loaded = await loadRoleForWrite(id, request.rev);
  if (!loaded.ok) return refuse(serviceError(loaded.failure.code, { details: loaded.failure.details }));
  const role = loaded.target.role;
  const { targetKey, lockId } = loaded.target;
  const oldDate = loaded.target.date;

  // Whitelist the stored types this route may mutate, and treat the STORED type
  // as authoritative: a request naming a different type is a stale or wrong view,
  // never a conversion (`_type` is immutable per document id).
  const MUTABLE_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;
  const roleType = role._type;
  if (!(MUTABLE_TYPES as readonly string[]).includes(roleType)) {
    return refuse(serviceError("invalid_request", { details: { issues: ["_type"] } }));
  }
  if (request.requestedType && request.requestedType !== roleType) {
    return refuse(
      serviceError("integrity_conflict", {
        details: { id, storedType: roleType, requestedType: request.requestedType },
      }),
    );
  }
  if (roleType === "special_role" && !request.serviceName) {
    return refuse(
      serviceError("integrity_conflict", {
        details: { id, storedType: roleType, issues: ["service_name"] },
      }),
    );
  }
  // The parser validates the SHAPE of `time`; only the stored type decides
  // whether one is allowed at all, and a weekend role refuses it outright
  // rather than dropping it silently.
  if (roleType !== "special_role" && request.time) {
    return refuse(
      serviceError("invalid_request", {
        details: { id, storedType: roleType, issues: ["time"] },
      }),
    );
  }
  const newDate = request.date;
  const isMove = newDate !== oldDate;
  const isSpecial = roleType === "special_role";
  const specialIdentityChanged =
    isSpecial &&
    (isMove || normalizeServiceName(role.service_name) !== normalizeServiceName(request.serviceName));

  // ── Dependency refusal (a move only; a same-date edit touches no history) ──
  if (isMove) {
    const dependencies = await loadDependencies({ operation: "move", role, newDate });
    if (!dependencies.usable) {
      return refuse(
        serviceError("integrity_conflict", { details: { dependencyIssues: dependencies.issues } }),
      );
    }
    if (dependencies.hasDependencies) {
      return refuse(serviceDependencyError(dependencies.code, dependencies.dependencies));
    }
  }

  // Every special PATCH checks its complete normalized identity, even when the
  // request changes only roster fields. Weekend occupancy remains move-only.
  if (isSpecial || isMove) {
    const occupancy = await loadTargetOccupancy({
      roleType,
      date: newDate,
      serviceName: request.serviceName,
      excludeRoleId: role._id,
    });
    if (occupancy.rawDraftIds.length) {
      return refuse(
        serviceError("integrity_conflict", {
          details: { destinationDate: newDate, rawDrafts: occupancy.rawDraftIds },
        }),
      );
    }
    if (occupancy.canonicalRoleIds.length) {
      return refuse(
        serviceError("ambiguous_target", {
          message: "Ya existe un servicio en la fecha destino.",
          details: { destinationDate: newDate, roleIds: occupancy.canonicalRoleIds },
        }),
      );
    }
  }

  // ── Coordination: assert the owned lock, bootstrapping a legacy one first ──
  let ownedLock: StoredLock | null = null;
  if (lockId) {
    ownedLock = await loadLock(lockId);
    if (request.lockRev && ownedLock && ownedLock._rev !== request.lockRev) {
      return refuse(
        serviceError("stale_revision", {
          details: { lockId, storedRev: ownedLock._rev, observedRev: request.lockRev },
        }),
      );
    }
    const plan = planOwnedLock({ lock: ownedLock, targetKey, roleId: role._id });
    if (plan.kind === "integrity") {
      return refuse(
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
      const code =
        boot.outcome === "committed_reload"
          ? "bootstrap_completed_reload"
          : boot.outcome === "unknown"
            ? "bootstrap_outcome_unknown"
            : "stale_revision";
      return refuse(serviceError(code, { details: { ...boot.details, id } }));
    }
  }

  let specialClaim: ReturnType<typeof planSpecialIdentityCoordinatorClaim> | null = null;
  if (specialIdentityChanged) {
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

  const now = nowIso();
  // The outbox `before` snapshot, captured PRE-COMMIT from the role this handler
  // has already loaded (§2). Reading it back inside the post-commit `after()`
  // block would return the POST-write state, so every notice would compare a
  // state against itself and say nothing.
  const beforeSeats = normalizeStoredSeats(role);
  const editPatch = buildRoleEditPatch({
    roleType,
    date: newDate,
    serviceName: request.serviceName,
    time: request.time,
    countsForFairness: request.countsForFairness,
    seats: request.seats,
    nextKey,
  });

  let tx = writeClient
    .transaction()
    .patch(role._id, (p) => {
      const patched = p.ifRevisionId(role._rev).set(editPatch.set);
      return editPatch.unset.length ? patched.unset(editPatch.unset) : patched;
    });

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
        return refuse(
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
          return refuse(
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
  if (specialClaim?.ok && specialClaim.kind === "create") {
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
    if (isSpecial) {
      const occupancyPromise = loadTargetOccupancy({
        roleType,
        date: newDate,
        serviceName: request.serviceName,
        excludeRoleId: role._id,
      });
      const coordinatorPromise = specialClaim
        ? loadSpecialIdentityCoordinator()
        : Promise.resolve(null);
      const [occupancy, coordinatorAfter] = await Promise.all([
        occupancyPromise,
        coordinatorPromise,
      ]);
      if (occupancy.rawDraftIds.length) {
        return refuse(
          serviceError("integrity_conflict", {
            details: { destinationDate: newDate, rawDrafts: occupancy.rawDraftIds },
          }),
        );
      }
      if (occupancy.canonicalRoleIds.length) {
        return refuse(
          serviceError("ambiguous_target", {
            details: { destinationDate: newDate, roleIds: occupancy.canonicalRoleIds },
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
            id,
            targetKey,
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
    return refuse(
      serviceError("stale_revision", {
        details: { id, targetKey },
      }),
    );
  }

  // ── Post-commit side effects (§7), all through the one shared module ───────
  // Solver v3 C1 §5.4.4: a PATCH that carries `countsForFairness` and changes
  // nothing a notice could report queues no notice and sends no push. A PATCH
  // without the field always takes the branch below, exactly as before.
  const noticeNeutral = isNoticeNeutralEdit({
    carriesCountsForFairness: request.countsForFairness !== undefined,
    roleType,
    storedDate: oldDate,
    requestedDate: newDate,
    storedServiceName: role.service_name,
    requestedServiceName: request.serviceName,
    storedTime: role.time,
    requestedTime: request.time,
    before: beforeSeats,
    after: request.seats,
  });
  let push: RoleAssignmentPushDescriptor | null = null;
  let notices: RoleNoticesDescriptor | null = null;
  let noticesQueued: boolean | null = null;
  if (!noticeNeutral) {
    // Recipients derive from committed server state across all five seat paths:
    // the previously stored assignees versus the seats just written. A draft edit
    // stays silent; published or grandfathered notifies only the newly added.
    push = notifyRoleAssignments([
      roleUpdateNotice({
        published: role.published,
        beforeAssignees: validateRole(role).assignedRefs,
        after: request.seats,
        type: roleType,
        date: newDate,
      }),
    ]);
    // The debounced email (§2): one notice per member in the UNION of before- and
    // after-assignees, so a member REMOVED by this edit is finally covered. On a
    // date move the snapshot stays valid — only the label moved — and the flush
    // re-dates from live state.
    const noticeInput = {
      roleId: role._id,
      roleType,
      serviceDate: newDate,
      published: role.published,
      beforeSeats,
      afterSeats: request.seats,
    };
    if (options.notices === "inline") {
      const queued = await queueRoleNoticesNow(noticeInput);
      notices = queued.descriptor;
      noticesQueued = queued.queued;
    } else {
      notices = queueRoleNotices(noticeInput);
    }
  }

  // Revalidation runs in every case, the toggle-only PATCH included.
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
  return {
    ok: true,
    status: 200,
    body: {
      ...(refreshed ?? {}),
      _id: role._id,
      _type: roleType,
      date: newDate,
      ok: true,
    },
    effects: {
      role,
      seats: { before: beforeSeats, after: request.seats },
      noticeNeutral,
      push,
      notices,
      noticesQueued,
      committedRev: typeof refreshed?._rev === "string" ? refreshed._rev : null,
    },
  };
}
