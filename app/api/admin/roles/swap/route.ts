// app/api/admin/roles/swap/route.ts
import { NextRequest, NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";

// Notifying the newly added assignees of two services can mean several
// sequential emails; give the after() work room to finish past the response.
export const maxDuration = 60;
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { addedAssignees } from "@/app/utils/notifyTargets";
import { sendPush } from "@/app/utils/push";
import { sendAssignmentEmails, type ServiceType } from "@/app/utils/assignmentEmail";
import { revalidateServiceViews } from "@/app/utils/revalidate";
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
 * Same-role, weekend↔weekend, weekend↔special and special↔special all assert
 * every involved role revision and coordination token in ONE transaction, so a
 * partial swap is impossible: any conflict rolls the whole thing back and returns
 * `409` with no business mutation.
 */
export async function POST(req: NextRequest) {
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

  revalidateServiceViews();
  revalidatePath("/me");

  // ── Post-commit additions, computed PER DESTINATION ROLE ──────────────────
  // Recipients come from committed server state across all five seat paths: the
  // seats stored before this transaction versus the seats it just wrote.
  const notifications: { added: string[]; type: ServiceType; date: string; body: NormalizedSeats }[] = [];
  for (const coordinated of coordination.roles) {
    if (!patchOf.has(coordinated.role._id)) continue;
    const before = normalizeStoredSeats(coordinated.role);
    const partnerId = partnerOf.get(coordinated.role._id);
    const after_ = partnerId
      ? normalizeStoredSeats(targetById.get(partnerId)?.role)
      : normalizeStoredSeats(coordinated.role, replacementsOf.get(coordinated.role._id) ?? []);
    const added = addedAssignees(seatAssignees(before), seatAssignees(after_));
    // Drafts stay silent; published or grandfathered services notify.
    if (!added.length || coordinated.role.published === false) continue;
    notifications.push({
      added,
      type: coordinated.role._type as ServiceType,
      date: coordinated.date,
      body: after_,
    });
  }
  if (notifications.length) {
    after(async () => {
      for (const n of notifications) {
        await sendPush(n.added, "assignments", {
          title: "Servicio actualizado",
          body: `Te asignaron para el ${n.date}.`,
          path: "/me",
        });
        await sendAssignmentEmails(n.added, { type: n.type, date: n.date, body: n.body });
      }
    });
  }

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
