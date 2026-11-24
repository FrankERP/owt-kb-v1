// The guarded role-delete writer (Service Readiness A2 §2/§3) — the domain body of
// `DELETE /api/admin/roles/[id]`, moved here VERBATIM so the MCP deletes
// (`delete_services` and its card twin `delete_services_app`, admin parity phase 2, T1)
// call the very same code path. The admin route keeps only its authorization prefix,
// its JSON parse and `parseDeleteRequest`; it cannot export this function itself,
// because Next type-checks a route module's export set against a fixed list.
//
// Requires the client-observed role revision. The dependency-refusal policy runs
// BEFORE any coordination maintenance; the business transaction then vacates an
// owned weekend token, retires a receipt-backed creation key, and deletes the
// role — atomically. A token owned by another role is never vacated.
//
// Boundary, and nothing else, differs from the route it came from: each refusal
// RETURNS `{ ok: false, status, body }` instead of sending it, success returns the
// same JSON as `body` plus `effects`. A commit that fails for any reason other than
// a revision conflict still THROWS, exactly as the route's 500 did.
//
// ONE option, `notices`, as `roleEditCommit.ts`: `"deferred"` (the route, unchanged)
// queues the «Ya no participas» notices in `after()` with the opportunistic sweep;
// `"inline"` (the MCP delete) awaits the upsert before returning, with no sweep, and
// reports in `effects.noticesQueued` whether it landed (`queueRoleNoticesNow`).
//
// This module is a registered protected writer (`PROTECTED_RUNTIME_WRITERS`), its
// callers are pinned by `serviceCommitCallers.test.ts`, and it is a
// delivery-capable import for the SR-verification run-context scan. ADR-0043.

import "server-only";

import { writeClient } from "@/sanity/lib/serverClient";
import {
  queueRoleNotices,
  queueRoleNoticesNow,
  revalidateRoleMutation,
  type RoleNoticesDescriptor,
} from "@/app/utils/serviceMutationSideEffects";
import { serviceDependencyError, serviceError, type ServiceErrorResponse } from "@/app/utils/serviceMutation";
import { retireReceiptPatch } from "@/app/utils/roleCreationReceipt";
import { vacateLockPatch } from "@/app/utils/roleTargetLock";
import {
  normalizeStoredSeats,
  planOwnedLock,
  roleDateField,
  sanityConflictKind,
  type NormalizedSeats,
  type ParsedDeleteRequest,
} from "@/app/utils/roleWriteRequest";
import {
  bootstrapLegacyLock,
  loadDependencies,
  loadLock,
  loadReceiptsForRole,
  loadRoleForWrite,
  nowIso,
  type StoredLock,
  type StoredRole,
} from "@/app/utils/roleWriteOps";
import type { CommitOutcome } from "@/app/utils/commitOutcome";

export interface RoleDeleteOptions {
  /** `"deferred"` (default, the route) or `"inline"` (the MCP delete). See the header. */
  notices?: "deferred" | "inline";
}

/** What a committed delete already held, for a caller that must report it. */
export interface RoleDeleteEffects {
  /** The role exactly as it was loaded, pre-commit. */
  role: StoredRole;
  /** The seats stored before the delete (pre-commit): who the notices are about. */
  beforeSeats: NormalizedSeats;
  /** `queueRoleNotices`' descriptor; null when it queued nothing (a draft, an empty team). */
  notices: RoleNoticesDescriptor | null;
  /** Inline mode only: whether the notices landed. `null` in deferred mode. */
  noticesQueued: boolean | null;
}

const refuse = (res: ServiceErrorResponse) => ({ ok: false as const, ...res });

export async function deleteRole(
  id: string,
  request: ParsedDeleteRequest,
  options: RoleDeleteOptions = {},
): Promise<CommitOutcome<RoleDeleteEffects>> {
  const loaded = await loadRoleForWrite(id, request.rev);
  if (!loaded.ok) return refuse(serviceError(loaded.failure.code, { details: loaded.failure.details }));
  const role = loaded.target.role;
  const { targetKey, lockId, date } = loaded.target;
  const dateField = roleDateField(role._type);

  // ── Dependency refusal, BEFORE any maintenance write ──────────────────────
  const dependencies = await loadDependencies({ operation: "delete", role });
  if (!dependencies.usable) {
    return refuse(serviceError("integrity_conflict", { details: { dependencyIssues: dependencies.issues } }));
  }
  if (dependencies.hasDependencies) {
    return refuse(serviceDependencyError(dependencies.code, dependencies.dependencies));
  }

  // ── Coordination token: only ever vacate a token this role owns ───────────
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
      return refuse(serviceError("integrity_conflict", { details: { lockId, detail: plan.detail } }));
    }
    if (plan.kind === "bootstrap") {
      const boot = await bootstrapLegacyLock({
        roleId: role._id,
        roleRev: role._rev,
        targetKey,
        dateField,
        date,
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

  // ── Receipt-backed key retirement (a durable idempotency tombstone) ───────
  const receipts = await loadReceiptsForRole(role._id);
  if (receipts.length > 1) {
    return refuse(
      serviceError("integrity_conflict", {
        details: { id, receiptIds: receipts.map((r) => r._id), detail: "multiple_receipts" },
      }),
    );
  }
  const receipt = receipts[0] ?? null;
  if (receipt && receipt.roleId !== role._id) {
    return refuse(
      serviceError("integrity_conflict", {
        details: { id, receiptId: receipt._id, detail: "receipt_owner_mismatch" },
      }),
    );
  }
  if (role.creationReceiptId && receipt && role.creationReceiptId !== receipt._id) {
    return refuse(
      serviceError("integrity_conflict", {
        details: { id, receiptId: receipt._id, detail: "receipt_link_mismatch" },
      }),
    );
  }

  const now = nowIso();
  // Captured PRE-COMMIT, from the role this writer already loaded: in a moment
  // the document is gone and nothing can answer for who served on it (§2).
  const beforeSeats = normalizeStoredSeats(role);
  const rolePublished = role.published;
  let tx = writeClient.transaction();
  if (ownedLock) {
    const vacate = vacateLockPatch({ generation: ownedLock.generation ?? null, now });
    const lockRev = ownedLock._rev;
    tx = tx.patch(ownedLock._id, (p) => p.ifRevisionId(lockRev).set(vacate.set).unset(vacate.unset));
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
  tx = tx.patch(role._id, (p) => p.ifRevisionId(roleRev).set({ [dateField]: date })).delete(role._id);

  try {
    await tx.commit();
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    return refuse(serviceError("stale_revision", { details: { id, targetKey } }));
  }

  // A removal is no longer silent. It sends no IMMEDIATE signal — there is no
  // "te asignaron" for a service that has ceased to exist — but it queues one
  // debounced notice per current assignee, snapshotted before the delete
  // committed (§2). At flush the role document is gone, which classifies as
  // "Ya no participas"; without this the deleted-role rule would be unreachable.
  // A member who was never on this service is not in `beforeSeats`, so they
  // stay silent. A draft delete stays silent too.
  const noticeInput = {
    roleId: role._id,
    roleType: role._type,
    serviceDate: date,
    published: rolePublished,
    beforeSeats,
    afterSeats: null,
    deleted: true,
  };
  let notices: RoleNoticesDescriptor | null;
  let noticesQueued: boolean | null = null;
  if (options.notices === "inline") {
    const queued = await queueRoleNoticesNow(noticeInput);
    notices = queued.descriptor;
    noticesQueued = queued.queued;
  } else {
    notices = queueRoleNotices(noticeInput);
  }
  revalidateRoleMutation();
  return {
    ok: true,
    status: 200,
    body: { ok: true, id: role._id },
    effects: { role, beforeSeats, notices, noticesQueued },
  };
}
