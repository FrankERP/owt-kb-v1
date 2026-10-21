// The guarded instrument-copy writer (Service Readiness A2 §4) — the domain body of
// `POST /api/admin/roles/copy-instruments`, moved here VERBATIM so the MCP
// `copy_instruments` tool (admin parity phase 1, S3) calls the very same code path.
// The admin route keeps only its authorization prefix and JSON parse.
//
// Exact request: `{ source: { id, rev }, target: { id, rev } }` — both
// client-observed role revisions are required. BOTH current singleton roles are
// read server-side and a cached client instrument payload is never accepted, so
// what lands on the target is always what the source stores right now.
//
// One transaction patches ONLY the target's `instruments` while asserting both
// role revisions and heartbeating both coordination tokens. A stale or deleted
// source, a stale target, a dangling assignment, an invalid target, or any
// conflict leaves the target's assignments unchanged.
//
// Boundary, and nothing else, differs from the route: refusals are RETURNED,
// success returns the same JSON as `body` plus `effects`; a non-conflict commit
// failure still THROWS. The `notices` option is `roleEditCommit.ts`'s.
//
// A registered protected writer (`PROTECTED_RUNTIME_WRITERS`), callers pinned by
// `serviceCommitCallers.test.ts`, a delivery-capable import. ADR-0043.

import "server-only";

import { writeClient } from "@/sanity/lib/serverClient";
import type { ServiceType } from "@/app/utils/assignmentEmail";
import {
  notifyRoleAssignments,
  queueRoleNotices,
  queueRoleNoticesNow,
  revalidateRoleMutation,
  roleUpdateNotice,
  type RoleAssignmentPushDescriptor,
  type RoleNoticesDescriptor,
} from "@/app/utils/serviceMutationSideEffects";
import { serviceError, type ServiceErrorResponse } from "@/app/utils/serviceMutation";
import {
  normalizeStoredSeats,
  parseCopyInstrumentsRequest,
  roleDateField,
  sanityConflictKind,
  seatAssignees,
  storedSeatArrays,
  type NormalizedSeats,
} from "@/app/utils/roleWriteRequest";
import {
  loadCanonicalMemberIds,
  loadRoleForWrite,
  nowIso,
  resolveOwnedCoordination,
  type StoredRole,
} from "@/app/utils/roleWriteOps";
import type { CommitOutcome } from "@/app/utils/commitOutcome";
import type { RoleEditOptions } from "@/app/utils/roleEditCommit";

/** What a committed copy already held. Nothing here is re-read after the commit. */
export interface CopyInstrumentsEffects {
  /** The destination role as loaded, pre-commit. */
  target: StoredRole;
  seats: { before: NormalizedSeats; after: NormalizedSeats };
  push: RoleAssignmentPushDescriptor;
  notices: RoleNoticesDescriptor | null;
  /** Inline mode only: whether the notices landed; `null` in deferred mode. */
  noticesQueued: boolean | null;
}

const refuse = (res: ServiceErrorResponse) => ({ ok: false as const, ...res });

export async function copyInstruments(
  body: unknown,
  options: RoleEditOptions = {},
): Promise<CommitOutcome<CopyInstrumentsEffects>> {
  const parsed = parseCopyInstrumentsRequest(body);
  if (!parsed.ok) {
    return refuse(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;

  // Only these three stored types may take part in a copy.
  const COPYABLE_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;

  const loadedSource = await loadRoleForWrite(request.source.id, request.source.rev);
  if (!loadedSource.ok) {
    return refuse(
      serviceError(loadedSource.failure.code, {
        details: { side: "source", ...loadedSource.failure.details },
      }),
    );
  }
  const loadedTarget = await loadRoleForWrite(request.target.id, request.target.rev);
  if (!loadedTarget.ok) {
    return refuse(
      serviceError(loadedTarget.failure.code, {
        details: { side: "target", ...loadedTarget.failure.details },
      }),
    );
  }
  for (const side of [loadedSource.target, loadedTarget.target]) {
    if (!(COPYABLE_TYPES as readonly string[]).includes(side.role._type)) {
      return refuse(serviceError("invalid_request", { details: { issues: ["_type"] } }));
    }
  }

  const sourceSeats = storedSeatArrays(loadedSource.target.role);
  if (!sourceSeats) {
    return refuse(serviceError("integrity_conflict", { details: { detail: "seat_arrays" } }));
  }
  // Stored items are copied as-is, so each item keeps its own `_key`, its
  // instrument label and its person reference.
  const instruments = sourceSeats.instruments;

  // The post-state of the destination: its own four other seats plus the
  // source's instruments.
  const afterSeats = {
    ...normalizeStoredSeats(loadedTarget.target.role),
    instruments: normalizeStoredSeats(loadedSource.target.role).instruments,
  };

  // ── Dangling assignment refusal ───────────────────────────────────────────
  const wanted = [...new Set(afterSeats.instruments.map((s) => s.personId))];
  const resolvedMembers = await loadCanonicalMemberIds(wanted);
  const dangling = wanted.filter((id) => !resolvedMembers.has(id));
  if (dangling.length) {
    return refuse(serviceError("integrity_conflict", { details: { danglingRefs: dangling } }));
  }

  // ── Coordination: assert/heartbeat both owned tokens in one transaction ────
  const coordination = await resolveOwnedCoordination([loadedSource.target, loadedTarget.target]);
  if (!coordination.ok) {
    return refuse(serviceError(coordination.failure.code, { details: coordination.failure.details }));
  }
  const coordinatedSource = coordination.roles.find((c) => c.role._id === request.source.id);
  const coordinatedTarget = coordination.roles.find((c) => c.role._id === request.target.id);
  if (!coordinatedSource || !coordinatedTarget) {
    return refuse(serviceError("integrity_conflict", { details: { detail: "coordination" } }));
  }

  // The outbox `before` snapshot, captured PRE-COMMIT from the destination role
  // this handler already loaded (§2). `afterSeats` above is likewise a
  // pre-commit value: it is exactly what the patch is about to write.
  const beforeSeats = normalizeStoredSeats(coordinatedTarget.role);

  const now = nowIso();
  const targetRev = coordinatedTarget.role._rev;
  const sourceRev = coordinatedSource.role._rev;
  let tx = writeClient
    .transaction()
    // Only the destination's instruments change.
    .patch(coordinatedTarget.role._id, (p) => p.ifRevisionId(targetRev).set({ instruments }))
    // The source is not modified, so its revision is asserted by a guarded no-op
    // heartbeat of its own unchanged date field: a moved source rolls everything
    // back rather than copying a lineup that no longer exists.
    .patch(coordinatedSource.role._id, (p) =>
      p
        .ifRevisionId(sourceRev)
        .set({ [roleDateField(coordinatedSource.role._type)]: coordinatedSource.date }),
    );
  const heartbeated = new Set<string>();
  for (const coordinated of [coordinatedTarget, coordinatedSource]) {
    const lock = coordinated.lock;
    if (!lock || heartbeated.has(lock._id)) continue;
    heartbeated.add(lock._id);
    const lockRev = lock._rev;
    tx = tx.patch(lock._id, (p) => p.ifRevisionId(lockRev).set({ updatedAt: now }));
  }

  try {
    await tx.commit();
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    return refuse(
      serviceError(coordination.bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
        details: { sourceId: request.source.id, targetId: request.target.id },
      }),
    );
  }

  // ── Post-commit side effects (§7), all through the one shared module ───────
  revalidateRoleMutation();

  // Additions for the ONE destination role, from committed server state.
  const push = notifyRoleAssignments([
    roleUpdateNotice({
      published: coordinatedTarget.role.published,
      beforeAssignees: seatAssignees(beforeSeats),
      after: afterSeats,
      type: coordinatedTarget.role._type as ServiceType,
      date: coordinatedTarget.date,
    }),
  ]);
  // The debounced email (§2) for the destination role only — the source is
  // untouched, so it has nothing to say. Overwriting the lineup DROPS whoever
  // held an instrument seat before, and the union rule is what covers them.
  const noticeInput = {
    roleId: coordinatedTarget.role._id,
    roleType: coordinatedTarget.role._type,
    serviceDate: coordinatedTarget.date,
    published: coordinatedTarget.role.published,
    beforeSeats,
    afterSeats,
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

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      sourceId: request.source.id,
      targetId: request.target.id,
      copied: instruments.length,
    },
    effects: { target: coordinatedTarget.role, seats: { before: beforeSeats, after: afterSeats }, push, notices, noticesQueued },
  };
}
