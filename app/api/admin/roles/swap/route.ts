// app/api/admin/roles/swap/route.ts
import { NextRequest, NextResponse } from "next/server";

// Notifying the newly added assignees of two services can mean several
// sequential emails; give the after() work room to finish past the response.
export const maxDuration = 60;
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import type { ServiceType } from "@/app/utils/assignmentEmail";
import {
  notifyRoleAssignments,
  queueRoleNotices,
  revalidateRoleMutation,
  roleUpdateNotice,
  type QueueRoleNoticesInput,
  type RoleAssignmentNotice,
} from "@/app/utils/serviceMutationSideEffects";
import { serviceError } from "@/app/utils/serviceMutation";
import {
  findSeatItem,
  normalizeStoredSeats,
  parseSwapRequest,
  sanityConflictKind,
  seatAssignees,
  seatPersonPatchPath,
  storedSeatArrays,
  type NormalizedSeats,
  type SeatPersonReplacement,
} from "@/app/utils/roleWriteRequest";
import {
  loadCanonicalMemberIds,
  loadRoleForWrite,
  nowIso,
  resolveOwnedCoordination,
  type RoleWriteTarget,
} from "@/app/utils/roleWriteOps";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/**
 * Atomic swap of assignments between service roles (A2 §4).
 *
 * Two shapes only:
 *   `{ kind: "seat",  source: { roleId, rev, path, itemKey }, target: { … } }`
 *   `{ kind: "team",  roles: [{ id, rev }, { id, rev }] }`
 *
 * The assignments written are derived from the CURRENT stored roles — a
 * replacement team payload is never accepted. A seat swap addresses items by
 * their stable stored `_key` (never a rendered index) and sets only the person
 * reference, so the destination `_key`, instrument label and FOH label are
 * preserved: the person moves, the seat does not. A team swap exchanges exactly
 * the five seat fields, so identity, date, service name, publication state, songs
 * and team notes are untouched.
 *
 * Same-role swaps, topology-compatible team swaps, and individual-seat swaps
 * assert every involved role revision and coordination token in ONE transaction, so a
 * partial swap is impossible: any conflict rolls the whole thing back and returns
 * `409` with no business mutation.
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
  const parsed = parseSwapRequest(body);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;

  // Only these three stored types may have their assignments swapped here.
  const SWAPPABLE_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;

  // ── Resolve every involved role under the revision the client observed ─────
  const selections =
    request.kind === "seat"
      ? dedupeSelections([
          { id: request.source.roleId, rev: request.source.rev },
          { id: request.target.roleId, rev: request.target.rev },
        ])
      : request.roles.map((r) => ({ id: r.id, rev: r.rev }));

  const targets: RoleWriteTarget[] = [];
  for (const selection of selections) {
    const loaded = await loadRoleForWrite(selection.id, selection.rev);
    if (!loaded.ok) {
      return reject(serviceError(loaded.failure.code, { details: loaded.failure.details }));
    }
    if (!(SWAPPABLE_TYPES as readonly string[]).includes(loaded.target.role._type)) {
      return reject(serviceError("invalid_request", { details: { issues: ["_type"] } }));
    }
    targets.push(loaded.target);
  }
  const targetById = new Map(targets.map((t) => [t.role._id, t]));

  // ── Stored topology admission — before member reads or coordination ───────
  // A Saturday never renders Chorus. Nonempty stored Chorus is therefore
  // hidden data, not an assignment a swap may silently move or erase.
  const hiddenSaturday = targets.find(
    (target) =>
      target.role._type === "saturday_role" &&
      Array.isArray(target.role.Chorus) &&
      target.role.Chorus.length > 0,
  );
  if (hiddenSaturday) {
    return reject(
      serviceError("integrity_conflict", {
        details: { detail: "hidden_saturday_chorus", roleId: hiddenSaturday.role._id },
      }),
    );
  }

  if (request.kind === "team") {
    const [first, second] = request.roles.map((selection) => targetById.get(selection.id)?.role);
    if (!first || !second) {
      return reject(serviceError("integrity_conflict", { details: { detail: "role_unresolved" } }));
    }
    const firstIsSaturday = first._type === "saturday_role";
    const secondIsSaturday = second._type === "saturday_role";
    if (firstIsSaturday !== secondIsSaturday) {
      return reject(
        serviceError("invalid_request", {
          details: { issues: ["incompatible_team_topology"] },
        }),
      );
    }
  }

  // ── Plan the writes from stored state ─────────────────────────────────────
  /** `set` payload per role id. */
  const patchOf = new Map<string, Record<string, unknown>>();
  /** Seat-level person replacements per role id, for the post-commit view. */
  const replacementsOf = new Map<string, SeatPersonReplacement[]>();
  /** Team-swap partner per role id: its post-state is the partner's stored seats. */
  const partnerOf = new Map<string, string>();
  const involvedPersonIds: string[] = [];

  if (request.kind === "seat") {
    const sourceRole = targetById.get(request.source.roleId)?.role;
    const targetRole = targetById.get(request.target.roleId)?.role;
    if (!sourceRole || !targetRole) {
      return reject(serviceError("integrity_conflict", { details: { detail: "role_unresolved" } }));
    }
    const sourceItem = findSeatItem(sourceRole, request.source.path, request.source.itemKey);
    if (!sourceItem) {
      return reject(serviceError("invalid_request", { details: { issues: ["source.itemKey"] } }));
    }
    const targetItem = findSeatItem(targetRole, request.target.path, request.target.itemKey);
    if (!targetItem) {
      return reject(serviceError("invalid_request", { details: { issues: ["target.itemKey"] } }));
    }
    const sourcePath = seatPersonPatchPath(request.source.path, request.source.itemKey);
    const targetPath = seatPersonPatchPath(request.target.path, request.target.itemKey);
    if (!sourcePath || !targetPath) {
      return reject(serviceError("invalid_request", { details: { issues: ["path"] } }));
    }

    // The person moves into the other seat; the seat itself (key + label) stays.
    addReplacement(replacementsOf, sourceRole._id, {
      path: request.source.path,
      itemKey: request.source.itemKey,
      personId: targetItem.personId,
    });
    addReplacement(replacementsOf, targetRole._id, {
      path: request.target.path,
      itemKey: request.target.itemKey,
      personId: sourceItem.personId,
    });
    mergePatch(patchOf, sourceRole._id, { [sourcePath]: targetItem.personId });
    mergePatch(patchOf, targetRole._id, { [targetPath]: sourceItem.personId });
    involvedPersonIds.push(sourceItem.personId, targetItem.personId);
  } else {
    const [first, second] = request.roles.map((r) => targetById.get(r.id)?.role);
    if (!first || !second) {
      return reject(serviceError("integrity_conflict", { details: { detail: "role_unresolved" } }));
    }
    const firstSeats = storedSeatArrays(first);
    const secondSeats = storedSeatArrays(second);
    if (!firstSeats || !secondSeats) {
      return reject(serviceError("integrity_conflict", { details: { detail: "seat_arrays" } }));
    }
    // Exactly the five seat fields are exchanged. `_key`s travel with their items
    // rather than being regenerated, and nothing else on either document is set.
    mergePatch(patchOf, first._id, { ...secondSeats });
    mergePatch(patchOf, second._id, { ...firstSeats });
    partnerOf.set(first._id, second._id);
    partnerOf.set(second._id, first._id);
    involvedPersonIds.push(
      ...seatAssignees(normalizeStoredSeats(first)),
      ...seatAssignees(normalizeStoredSeats(second)),
    );
  }

  // ── Dangling assignment refusal ───────────────────────────────────────────
  const wanted = [...new Set(involvedPersonIds)];
  const resolvedMembers = await loadCanonicalMemberIds(wanted);
  const dangling = wanted.filter((id) => !resolvedMembers.has(id));
  if (dangling.length) {
    return reject(
      serviceError("integrity_conflict", { details: { danglingRefs: dangling } }),
    );
  }

  // ── Coordination: assert every owned token (legacy locks bootstrap first) ──
  const coordination = await resolveOwnedCoordination(targets);
  if (!coordination.ok) {
    return reject(
      serviceError(coordination.failure.code, { details: coordination.failure.details }),
    );
  }

  // ── The seat states, resolved PRE-COMMIT ─────────────────────────────────
  // Both sides are derived from the roles this handler has already loaded, plus
  // the exact replacements this transaction is about to write. Computing them
  // here rather than in the post-commit block is the point (§2): after the
  // commit a re-read would return the post-write state on BOTH sides, and every
  // notice would compare a state against itself.
  const seatStatesOf = new Map<string, { before: NormalizedSeats; after: NormalizedSeats }>();
  for (const coordinated of coordination.roles) {
    if (!patchOf.has(coordinated.role._id)) continue;
    const partnerId = partnerOf.get(coordinated.role._id);
    seatStatesOf.set(coordinated.role._id, {
      before: normalizeStoredSeats(coordinated.role),
      after: partnerId
        ? normalizeStoredSeats(targetById.get(partnerId)?.role)
        : normalizeStoredSeats(coordinated.role, replacementsOf.get(coordinated.role._id) ?? []),
    });
  }

  // ── One transaction: every role patch plus every coordination token ───────
  const now = nowIso();
  let tx = writeClient.transaction();
  for (const coordinated of coordination.roles) {
    const set = patchOf.get(coordinated.role._id);
    if (!set) continue;
    const rev = coordinated.role._rev;
    tx = tx.patch(coordinated.role._id, (p) => p.ifRevisionId(rev).set(set));
  }
  const heartbeated = new Set<string>();
  for (const coordinated of coordination.roles) {
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
        details: { roleIds: [...patchOf.keys()] },
      }),
    );
  }

  // ── Post-commit side effects (§7), all through the one shared module ───────
  revalidateRoleMutation();

  // Additions computed PER DESTINATION ROLE. Recipients come from committed
  // server state across all five seat paths: the seats stored before this
  // transaction versus the seats it just wrote. Drafts stay silent.
  const notices: (RoleAssignmentNotice | null)[] = [];
  const queued: QueueRoleNoticesInput[] = [];
  for (const coordinated of coordination.roles) {
    const seatStates = seatStatesOf.get(coordinated.role._id);
    if (!seatStates) continue;
    notices.push(
      roleUpdateNotice({
        published: coordinated.role.published,
        beforeAssignees: seatAssignees(seatStates.before),
        after: seatStates.after,
        type: coordinated.role._type as ServiceType,
        date: coordinated.date,
      }),
    );
    queued.push({
      roleId: coordinated.role._id,
      roleType: coordinated.role._type,
      serviceDate: coordinated.date,
      published: coordinated.role.published,
      beforeSeats: seatStates.before,
      afterSeats: seatStates.after,
    });
  }
  notifyRoleAssignments(notices);
  // The debounced email (§2), per destination role. A swap is where the union
  // rule earns its keep: the person who LEFT a seat is in `before` and not in
  // `after`, and under the old added-assignees diff heard nothing at all.
  for (const input of queued) queueRoleNotices(input);

  return NextResponse.json({ ok: true, kind: request.kind, roleIds: [...patchOf.keys()] });
}

/** Distinct `{ id, rev }` selections, preserving request order. */
function dedupeSelections(rows: { id: string; rev: string }[]): { id: string; rev: string }[] {
  const out: { id: string; rev: string }[] = [];
  for (const row of rows) if (!out.some((r) => r.id === row.id)) out.push(row);
  return out;
}

function mergePatch(
  map: Map<string, Record<string, unknown>>,
  id: string,
  values: Record<string, unknown>,
) {
  map.set(id, { ...(map.get(id) ?? {}), ...values });
}

function addReplacement(
  map: Map<string, SeatPersonReplacement[]>,
  id: string,
  replacement: SeatPersonReplacement,
) {
  map.set(id, [...(map.get(id) ?? []), replacement]);
}
