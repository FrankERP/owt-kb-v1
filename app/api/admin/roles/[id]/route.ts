import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { queueRoleNotices, revalidateRoleMutation } from "@/app/utils/serviceMutationSideEffects";
import { editRole } from "@/app/utils/roleEditCommit";
import { serviceDependencyError, serviceError } from "@/app/utils/serviceMutation";
import { retireReceiptPatch } from "@/app/utils/roleCreationReceipt";
import { vacateLockPatch } from "@/app/utils/roleTargetLock";
import {
  normalizeStoredSeats,
  parseDeleteRequest,
  parseEditRequest,
  planOwnedLock,
  roleDateField,
  sanityConflictKind,
} from "@/app/utils/roleWriteRequest";
import {
  bootstrapLegacyLock,
  loadDependencies,
  loadLock,
  loadReceiptsForRole,
  loadRoleForWrite,
  nowIso,
  type RoleWriteTarget,
  type StoredLock,
} from "@/app/utils/roleWriteOps";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

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
 * This handler authorizes, parses JSON and the edit request only. Everything after
 * that is `editRole` (`app/utils/roleEditCommit.ts`), the one edit writer the MCP
 * stored-service save calls too (admin parity phase 1, T2.1); its outcome's `body`
 * and `status` are sent as-is.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const PATCH = withVerificationRunContext(patchHandler);

async function patchHandler(
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
  const outcome = await editRole(id, parsed.value);
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/**
 * Delete one service role (A2 §2/§3).
 *
 * Requires the client-observed role revision. The dependency-refusal policy runs
 * BEFORE any coordination maintenance; the business transaction then vacates an
 * owned weekend token, retires a receipt-backed creation key, and deletes the
 * role — atomically. A token owned by another role is never vacated.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const DELETE = withVerificationRunContext(deleteHandler);

async function deleteHandler(
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
  const role = loaded.target.role;
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
      const code =
        boot.outcome === "committed_reload"
          ? "bootstrap_completed_reload"
          : boot.outcome === "unknown"
            ? "bootstrap_outcome_unknown"
            : "stale_revision";
      return reject(serviceError(code, { details: { ...boot.details, id } }));
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
  // Captured PRE-COMMIT, from the role this handler already loaded: in a moment
  // the document is gone and nothing can answer for who served on it (§2).
  const beforeSeats = normalizeStoredSeats(role);
  const rolePublished = role.published;
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
      serviceError("stale_revision", {
        details: { id, targetKey },
      }),
    );
  }

  // A removal is no longer silent. It sends no IMMEDIATE signal — there is no
  // "te asignaron" for a service that has ceased to exist — but it queues one
  // debounced notice per current assignee, snapshotted before the delete
  // committed (§2). At flush the role document is gone, which classifies as
  // "Ya no participas"; without this the deleted-role rule would be unreachable.
  // A member who was never on this service is not in `beforeSeats`, so they
  // stay silent. A draft delete stays silent too.
  queueRoleNotices({
    roleId: role._id,
    roleType: role._type,
    serviceDate: date,
    published: rolePublished,
    beforeSeats,
    afterSeats: null,
    deleted: true,
  });
  revalidateRoleMutation();
  return NextResponse.json({ ok: true, id: role._id });
}
