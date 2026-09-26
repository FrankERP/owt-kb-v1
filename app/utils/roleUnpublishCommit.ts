// The narrow unpublish writer (Plan B item 3) — the domain body of
// `POST /api/admin/roles/unpublish`, moved here VERBATIM so the MCP
// `unpublish_service` tool calls the very same code path. The admin route
// keeps only its authorization prefix and JSON parse; it cannot export this
// function itself, because Next type-checks a route module's export set
// against a fixed list.
//
// Unpublish is a SEPARATE safety capability. It deliberately does not use
// publish readiness or override eligibility at all:
//
//   { roles: [{ id, rev }] }                 // hide these published services
//   { mode: "recover", roles: [{ id }] }      // READ ONLY outcome verification
//
// A published service may be hidden even when its team, availability, setlist
// or proposal is unsafe, incomplete, conflicted, invalid or unavailable — that
// is precisely when hiding it matters. No blocker acknowledgements are
// accepted, and no member / setlist / proposal observation is required or
// read.
//
// What IS required is narrow and about the write target only, proven from the
// A1/A2 role-target observation through A2's shared helpers:
//   - the id resolves to exactly ONE canonical role (never an arbitrary pick),
//   - it carries no raw `drafts.` overlay,
//   - its record is structurally usable and its observed revision still matches,
//   - no other canonical role or raw draft occupies the same service target,
//   - the weekend coordination token is owned by THIS role (a special service is
//     serialized by its own revision and takes no lock).
// Any of those failing is a `409`, and nothing is written.
//
// `published: false` then goes through A2's guarded publication contract: one
// revision-asserted transaction that also heartbeats every involved token. An
// unpublish notifies nobody and runs no sweep — it is silent by design (A2 §7);
// only a real `false -> true` notifies.
//
// Boundary, and nothing else, differs from the route it came from: each
// refusal RETURNS `{ ok: false, status, body }` instead of sending it (the
// recovery `503` included, with no `effects`), the recovered `200` carries an
// explicit empty `effects`, and success adds `effects` built from state this
// function already held — nothing is re-read after the commit. A commit that
// fails for any reason other than a revision conflict still THROWS, exactly
// as the route's 500 did.
//
// This module is a registered protected writer (`PROTECTED_RUNTIME_WRITERS`,
// `app/utils/roleUnpublishCommit.ts#module`), its callers are pinned by
// `serviceCommitCallers.test.ts`, and it is a delivery-capable import for the
// SR-verification run-context scan. Adding a caller means touching that pin.
// Why the writers live here and not in their routes: ADR-0041.

import "server-only";

import { writeClient } from "@/sanity/lib/serverClient";
import { revalidateRolePublication } from "@/app/utils/serviceMutationSideEffects";
import { computePublishTransitions } from "@/app/utils/publishTransitions";
import { serviceError } from "@/app/utils/serviceMutation";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import {
  loadRoleForWrite,
  loadTargetOccupancy,
  nowIso,
  resolveOwnedCoordination,
  type CoordinatedRole,
  type RoleWriteTarget,
} from "@/app/utils/roleWriteOps";
import {
  allObservedIn,
  observePublicationStates,
  parseUnpublishRequest,
} from "@/app/utils/publishReadyBundle";
import type { CommitOutcome } from "@/app/utils/commitOutcome";

/**
 * What a committed unpublish already held, for a caller that must report it.
 * Nothing here is re-read after the commit, and nothing deferred (there is no
 * `after()` block here — an unpublish notifies nobody) holds either field, so
 * neither needs a copy.
 */
export interface RoleUnpublishEffects {
  /** Ids actually patched to `published: false` in this transaction, in `roles` order. Empty when every requested role was already draft. */
  toPatch: string[];
  /** Requested roles that were already draft — a silent no-op; this transaction wrote none of them. */
  alreadyDraft: CoordinatedRole[];
}

export async function unpublishRoles(body: unknown): Promise<CommitOutcome<RoleUnpublishEffects>> {
  const parsed = parseUnpublishRequest(body);
  if (!parsed.ok) {
    return { ok: false, ...serviceError("invalid_request", { details: { issues: parsed.issues } }) };
  }
  const { mode, entries } = parsed.value;

  // Only these three stored types have a service publication state at all.
  const PUBLISHABLE_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;

  // ── Recovery for a lost/unknown response: refetch identity + state only ────
  if (mode === "recover") {
    const observed = await observePublicationStates(entries.map((e) => e.id));
    if (!observed.ok) {
      return {
        ok: false,
        status: 503,
        body: {
          error: "unknown_outcome",
          outcome: "unknown",
          message: "No se pudo confirmar el resultado. Vuelve a intentar la verificación.",
        },
      };
    }
    if (allObservedIn(observed.states, "draft")) {
      // Already hidden: recovered success, with no second mutation.
      return {
        ok: true,
        status: 200,
        body: { ok: true, mode, outcome: "recovered", services: observed.states },
        effects: { toPatch: [], alreadyDraft: [] },
      };
    }
    return {
      ok: false,
      ...serviceError("stale_revision", {
        message: "El resultado no coincide con lo solicitado. Recarga y vuelve a intentar.",
        details: { outcome: "not_in_requested_state", services: observed.states },
      }),
    };
  }

  // ── Narrow safe-targeting proof, per role ─────────────────────────────────
  const targets: RoleWriteTarget[] = [];
  for (const entry of entries) {
    const load = await loadRoleForWrite(entry.id, entry.rev);
    if (!load.ok) {
      return { ok: false, ...serviceError(load.failure.code, { details: load.failure.details }) };
    }
    const target = load.target;
    if (!(PUBLISHABLE_TYPES as readonly string[]).includes(target.role._type)) {
      return {
        ok: false,
        ...serviceError("integrity_conflict", {
          details: { id: entry.id, detail: "unexpected_type" },
        }),
      };
    }
    // A duplicate or draft-conflicted service target is an ambiguous write target,
    // even though the id itself resolved to one document.
    const occupancy = await loadTargetOccupancy({
      roleType: target.role._type,
      date: target.date,
      serviceName: target.role.service_name ?? null,
      excludeRoleId: entry.id,
    });
    if (occupancy.canonicalRoleIds.length > 0) {
      return {
        ok: false,
        ...serviceError("ambiguous_target", {
          details: {
            id: entry.id,
            targetKey: target.targetKey,
            conflictingIds: occupancy.canonicalRoleIds,
          },
        }),
      };
    }
    if (occupancy.rawDraftIds.length > 0) {
      return {
        ok: false,
        ...serviceError("integrity_conflict", {
          details: { id: entry.id, rawDrafts: occupancy.rawDraftIds },
        }),
      };
    }
    targets.push(target);
  }

  // Weekend lock ownership (A2 §1). A wrong-owner, vacant or malformed token is an
  // integrity conflict and is never implicitly reclaimed.
  const coordination = await resolveOwnedCoordination(targets);
  if (!coordination.ok) {
    return {
      ok: false,
      ...serviceError(coordination.failure.code, { details: coordination.failure.details }),
    };
  }

  const roles = coordination.roles;
  const revById = new Map(roles.map((r) => [r.role._id, r.role._rev]));
  // Missing `published` is grandfathered published, so a legacy service IS hidden
  // by this call; an already-hidden one is a silent no-op.
  const { toPatch } = computePublishTransitions(
    roles.map((r) => ({ _id: r.role._id, published: r.role.published })),
    false,
  );

  if (toPatch.length) {
    const now = nowIso();
    let tx = writeClient.transaction();
    for (const id of toPatch) {
      const rev = revById.get(id) as string;
      tx = tx.patch(id, (p) => p.ifRevisionId(rev).set({ published: false }));
    }
    for (const role of roles) {
      const lock = role.lock;
      if (!lock) continue;
      tx = tx.patch(lock._id, (p) => p.ifRevisionId(lock._rev).set({ updatedAt: now }));
    }
    try {
      await tx.commit();
    } catch (err) {
      if (!sanityConflictKind(err)) throw err;
      return {
        ok: false,
        ...serviceError(coordination.bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
          details: { ids: toPatch },
        }),
      };
    }
    // Member-facing caches must drop the hidden service promptly.
    revalidateRolePublication();
  }

  const effects: RoleUnpublishEffects = {
    toPatch,
    alreadyDraft: roles.filter((r) => !toPatch.includes(r.role._id)),
  };

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      unpublished: toPatch.length,
      services: roles.map((r) => ({ id: r.role._id })),
    },
    effects,
  };
}
