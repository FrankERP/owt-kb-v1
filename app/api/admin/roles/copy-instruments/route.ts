// app/api/admin/roles/copy-instruments/route.ts
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import type { ServiceType } from "@/app/utils/assignmentEmail";
import {
  notifyRoleAssignments,
  revalidateRoleMutation,
  roleUpdateNotice,
} from "@/app/utils/serviceMutationSideEffects";
import { serviceError } from "@/app/utils/serviceMutation";
import {
  normalizeStoredSeats,
  parseCopyInstrumentsRequest,
  roleDateField,
  sanityConflictKind,
  seatAssignees,
  storedSeatArrays,
} from "@/app/utils/roleWriteRequest";
import {
  loadCanonicalMemberIds,
  loadRoleForWrite,
  nowIso,
  resolveOwnedCoordination,
} from "@/app/utils/roleWriteOps";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/**
 * Copy one service's instrument lineup onto another day (A2 §4).
 *
 * Exact request: `{ source: { id, rev }, target: { id, rev } }` — both
 * client-observed role revisions are required. BOTH current singleton roles are
 * read server-side and a cached client instrument payload is never accepted, so
 * what lands on the target is always what the source stores right now.
 *
 * One transaction patches ONLY the target's `instruments` while asserting both
 * role revisions and heartbeating both coordination tokens. A stale or deleted
 * source, a stale target, a dangling assignment, an invalid target, or any
 * conflict leaves the target's assignments unchanged.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const POST = withVerificationRunContext(postHandler);

async function postHandler(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session || session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const parsed = parseCopyInstrumentsRequest(body);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;

  // Only these three stored types may take part in a copy.
  const COPYABLE_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;

  const loadedSource = await loadRoleForWrite(request.source.id, request.source.rev);
  if (!loadedSource.ok) {
    return reject(
      serviceError(loadedSource.failure.code, {
        details: { side: "source", ...loadedSource.failure.details },
      }),
    );
  }
  const loadedTarget = await loadRoleForWrite(request.target.id, request.target.rev);
  if (!loadedTarget.ok) {
    return reject(
      serviceError(loadedTarget.failure.code, {
        details: { side: "target", ...loadedTarget.failure.details },
      }),
    );
  }
  for (const side of [loadedSource.target, loadedTarget.target]) {
    if (!(COPYABLE_TYPES as readonly string[]).includes(side.role._type)) {
      return reject(serviceError("invalid_request", { details: { issues: ["_type"] } }));
    }
  }

  const sourceSeats = storedSeatArrays(loadedSource.target.role);
  if (!sourceSeats) {
    return reject(serviceError("integrity_conflict", { details: { detail: "seat_arrays" } }));
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
    return reject(serviceError("integrity_conflict", { details: { danglingRefs: dangling } }));
  }

  // ── Coordination: assert/heartbeat both owned tokens in one transaction ────
  const coordination = await resolveOwnedCoordination([loadedSource.target, loadedTarget.target]);
  if (!coordination.ok) {
    return reject(
      serviceError(coordination.failure.code, { details: coordination.failure.details }),
    );
  }
  const coordinatedSource = coordination.roles.find((c) => c.role._id === request.source.id);
  const coordinatedTarget = coordination.roles.find((c) => c.role._id === request.target.id);
  if (!coordinatedSource || !coordinatedTarget) {
    return reject(serviceError("integrity_conflict", { details: { detail: "coordination" } }));
  }

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
    return reject(
      serviceError(coordination.bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
        details: { sourceId: request.source.id, targetId: request.target.id },
      }),
    );
  }

  // ── Post-commit side effects (§7), all through the one shared module ───────
  revalidateRoleMutation();

  // Additions for the ONE destination role, from committed server state.
  const before = normalizeStoredSeats(coordinatedTarget.role);
  notifyRoleAssignments([
    roleUpdateNotice({
      published: coordinatedTarget.role.published,
      beforeAssignees: seatAssignees(before),
      after: afterSeats,
      type: coordinatedTarget.role._type as ServiceType,
      date: coordinatedTarget.date,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    sourceId: request.source.id,
    targetId: request.target.id,
    copied: instruments.length,
  });
}
