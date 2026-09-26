// The atomic role-swap writer (Service Readiness A2 §4) — the domain body of
// `POST /api/admin/roles/swap`, moved here VERBATIM so the MCP `swap_assignment`
// tool calls the very same code path. The admin route keeps only its
// authorization prefix and JSON parse; it cannot export this function itself,
// because Next type-checks a route module's export set against a fixed list.
//
// Three request shapes:
//   `{ kind: "seat",  source: { roleId, rev, path, itemKey }, target: { … } }`
//   `{ kind: "section", path, roles: [{ id, rev }, { id, rev }] }`
//   `{ kind: "team",  roles: [{ id, rev }, { id, rev }] }`
//
// The assignments written are derived from the CURRENT stored roles — a
// replacement team payload is never accepted. A seat swap addresses items by
// their stable stored `_key` (never a rendered index) and sets only the person
// reference, so the destination `_key`, instrument label and FOH label are
// preserved: the person moves, the seat does not. A section swap exchanges one
// complete stored array, while a team swap exchanges exactly the five seat
// fields. Identity, date, service name, publication state, songs and team notes
// are untouched.
//
// Same-role swaps, topology-compatible team swaps, and individual-seat swaps
// assert every involved role revision and coordination token in ONE transaction, so a
// partial swap is impossible: any conflict rolls the whole thing back and returns
// `409` with no business mutation.
//
// Boundary, and nothing else, differs from the route it came from: each
// refusal RETURNS `{ ok: false, status, body }` instead of sending it, success
// returns the same JSON as `body` plus `effects`, and the two post-commit
// helpers' return values (their descriptors) are captured at their existing
// call sites. A commit that fails for any reason other than a revision/creation
// conflict still THROWS, exactly as the route's 500 did.
//
// This module is a registered protected writer (`PROTECTED_RUNTIME_WRITERS`,
// `app/utils/roleSwapCommit.ts#module`), its callers are pinned by
// `serviceCommitCallers.test.ts`, and it is a delivery-capable import for the
// SR-verification run-context scan. Adding a caller means touching that pin.
// Why the writers live here and not in their routes: ADR-0041.

import "server-only";

import { writeClient } from "@/sanity/lib/serverClient";
import type { ServiceType } from "@/app/utils/assignmentEmail";
import {
  notifyRoleAssignments,
  queueRoleNotices,
  revalidateRoleMutation,
  roleUpdateNotice,
  type QueueRoleNoticesInput,
  type RoleAssignmentNotice,
  type RoleAssignmentPushDescriptor,
  type RoleNoticesDescriptor,
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
  type SeatPath,
  type SeatPersonReplacement,
} from "@/app/utils/roleWriteRequest";
import {
  loadCanonicalMemberIds,
  loadRoleForWrite,
  nowIso,
  resolveOwnedCoordination,
  type RoleWriteTarget,
  type StoredRole,
} from "@/app/utils/roleWriteOps";
import type { CommitOutcome } from "@/app/utils/commitOutcome";

/**
 * What one coordinated role's swap already held, for a caller that must report
 * the write. Nothing here is re-read after the commit.
 */
export interface RoleSwapRoleEffect {
  /** The role exactly as `loadRoleForWrite` loaded it, pre-commit: the full `ROLE_PROJECTION` row. */
  role: StoredRole;
  /** The raw `set` payload this transaction wrote for it (`patchOf.get(role._id)`), `_key`s included. */
  set: Record<string, unknown>;
  /** The seat states resolved PRE-COMMIT, from state this handler had already loaded (§2 below). */
  seatStates: { before: NormalizedSeats; after: NormalizedSeats };
  /** `queueRoleNotices`' descriptor for this role; null when it queued nothing. */
  notice: RoleNoticesDescriptor | null;
}

/**
 * What a committed swap already held, for a caller that must report it. Nothing
 * here is re-read after the commit.
 */
export interface RoleSwapEffects {
  /** Every role this swap patched, in the transaction's own order. */
  roles: RoleSwapRoleEffect[];
  /** `notifyRoleAssignments`' descriptor for the whole batch. */
  push: RoleAssignmentPushDescriptor;
}

export async function swapRoles(body: unknown): Promise<CommitOutcome<RoleSwapEffects>> {
  const parsed = parseSwapRequest(body);
  if (!parsed.ok) {
    return { ok: false, ...serviceError("invalid_request", { details: { issues: parsed.issues } }) };
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
      return { ok: false, ...serviceError(loaded.failure.code, { details: loaded.failure.details }) };
    }
    if (!(SWAPPABLE_TYPES as readonly string[]).includes(loaded.target.role._type)) {
      return { ok: false, ...serviceError("invalid_request", { details: { issues: ["_type"] } }) };
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
    return {
      ok: false,
      ...serviceError("integrity_conflict", {
        details: { detail: "hidden_saturday_chorus", roleId: hiddenSaturday.role._id },
      }),
    };
  }

  if (request.kind === "team") {
    const [first, second] = request.roles.map((selection) => targetById.get(selection.id)?.role);
    if (!first || !second) {
      return {
        ok: false,
        ...serviceError("integrity_conflict", { details: { detail: "role_unresolved" } }),
      };
    }
    const firstIsSaturday = first._type === "saturday_role";
    const secondIsSaturday = second._type === "saturday_role";
    if (firstIsSaturday !== secondIsSaturday) {
      return {
        ok: false,
        ...serviceError("invalid_request", {
          details: { issues: ["incompatible_team_topology"] },
        }),
      };
    }
  }

  if (request.kind === "section" && request.path === "Chorus") {
    const includesSaturday = request.roles.some(
      (selection) => targetById.get(selection.id)?.role._type === "saturday_role",
    );
    if (includesSaturday) {
      return {
        ok: false,
        ...serviceError("invalid_request", {
          details: { issues: ["incompatible_section_topology"] },
        }),
      };
    }
  }

  // ── Plan the writes from stored state ─────────────────────────────────────
  /** `set` payload per role id. */
  const patchOf = new Map<string, Record<string, unknown>>();
  /** Seat-level person replacements per role id, for the post-commit view. */
  const replacementsOf = new Map<string, SeatPersonReplacement[]>();
  /** Stored-state-derived post-commit seats for team and section swaps. */
  const afterSeatsOf = new Map<string, NormalizedSeats>();
  const involvedPersonIds: string[] = [];

  if (request.kind === "seat") {
    const sourceRole = targetById.get(request.source.roleId)?.role;
    const targetRole = targetById.get(request.target.roleId)?.role;
    if (!sourceRole || !targetRole) {
      return {
        ok: false,
        ...serviceError("integrity_conflict", { details: { detail: "role_unresolved" } }),
      };
    }
    const sourceItem = findSeatItem(sourceRole, request.source.path, request.source.itemKey);
    if (!sourceItem) {
      return { ok: false, ...serviceError("invalid_request", { details: { issues: ["source.itemKey"] } }) };
    }
    const targetItem = findSeatItem(targetRole, request.target.path, request.target.itemKey);
    if (!targetItem) {
      return { ok: false, ...serviceError("invalid_request", { details: { issues: ["target.itemKey"] } }) };
    }
    const sourcePath = seatPersonPatchPath(request.source.path, request.source.itemKey);
    const targetPath = seatPersonPatchPath(request.target.path, request.target.itemKey);
    if (!sourcePath || !targetPath) {
      return { ok: false, ...serviceError("invalid_request", { details: { issues: ["path"] } }) };
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
      return {
        ok: false,
        ...serviceError("integrity_conflict", { details: { detail: "role_unresolved" } }),
      };
    }
    const firstSeats = storedSeatArrays(first);
    const secondSeats = storedSeatArrays(second);
    if (!firstSeats || !secondSeats) {
      return { ok: false, ...serviceError("integrity_conflict", { details: { detail: "seat_arrays" } }) };
    }
    if (request.kind === "section") {
      const path = request.path;
      // The complete selected arrays travel unchanged, including order, keys,
      // item types, labels, references, emptiness and differing cardinality.
      mergePatch(patchOf, first._id, { [path]: secondSeats[path] });
      mergePatch(patchOf, second._id, { [path]: firstSeats[path] });
      const firstBefore = normalizeStoredSeats(first);
      const secondBefore = normalizeStoredSeats(second);
      afterSeatsOf.set(first._id, normalizeStoredSeats({ ...first, [path]: secondSeats[path] }));
      afterSeatsOf.set(second._id, normalizeStoredSeats({ ...second, [path]: firstSeats[path] }));
      involvedPersonIds.push(
        ...sectionAssignees(firstBefore, path),
        ...sectionAssignees(secondBefore, path),
      );
    } else {
      // Exactly the five seat fields are exchanged. `_key`s travel with their
      // items rather than being regenerated, and nothing else is set.
      mergePatch(patchOf, first._id, { ...secondSeats });
      mergePatch(patchOf, second._id, { ...firstSeats });
      afterSeatsOf.set(first._id, normalizeStoredSeats(second));
      afterSeatsOf.set(second._id, normalizeStoredSeats(first));
      involvedPersonIds.push(
        ...seatAssignees(normalizeStoredSeats(first)),
        ...seatAssignees(normalizeStoredSeats(second)),
      );
    }
  }

  // ── Dangling assignment refusal ───────────────────────────────────────────
  const wanted = [...new Set(involvedPersonIds)];
  const resolvedMembers = await loadCanonicalMemberIds(wanted);
  const dangling = wanted.filter((id) => !resolvedMembers.has(id));
  if (dangling.length) {
    return {
      ok: false,
      ...serviceError("integrity_conflict", { details: { danglingRefs: dangling } }),
    };
  }

  // ── Coordination: assert every owned token (legacy locks bootstrap first) ──
  const coordination = await resolveOwnedCoordination(targets);
  if (!coordination.ok) {
    return {
      ok: false,
      ...serviceError(coordination.failure.code, { details: coordination.failure.details }),
    };
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
    seatStatesOf.set(coordinated.role._id, {
      before: normalizeStoredSeats(coordinated.role),
      after:
        afterSeatsOf.get(coordinated.role._id) ??
        normalizeStoredSeats(coordinated.role, replacementsOf.get(coordinated.role._id) ?? []),
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
    return {
      ok: false,
      ...serviceError(coordination.bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
        details: { roleIds: [...patchOf.keys()] },
      }),
    };
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
  const pushDescriptor = notifyRoleAssignments(notices);
  // The debounced email (§2), per destination role. A swap is where the union
  // rule earns its keep: the person who LEFT a seat is in `before` and not in
  // `after`, and under the old added-assignees diff heard nothing at all.
  const noticeDescriptors: (RoleNoticesDescriptor | null)[] = [];
  for (const input of queued) noticeDescriptors.push(queueRoleNotices(input));

  // What this write already held, for a caller that must report it (the
  // module header). Every value below comes from state this function already
  // resolved — nothing is re-read after the commit.
  const roles: RoleSwapRoleEffect[] = queued.map((input, i) => ({
    role: targetById.get(input.roleId)!.role,
    set: patchOf.get(input.roleId)!,
    seatStates: seatStatesOf.get(input.roleId)!,
    notice: noticeDescriptors[i],
  }));
  const effects: RoleSwapEffects = { roles, push: pushDescriptor };

  return {
    ok: true,
    status: 200,
    body: { ok: true, kind: request.kind, roleIds: [...patchOf.keys()] },
    effects,
  };
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

function sectionAssignees(seats: NormalizedSeats, path: SeatPath): string[] {
  if (path === "Lead") return seats.leads;
  if (path === "BGVs") return seats.bgvs;
  if (path === "Chorus") return seats.chorus;
  if (path === "instruments") return seats.instruments.map((slot) => slot.personId);
  return seats.foh.map((slot) => slot.personId);
}
