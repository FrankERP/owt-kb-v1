// app/api/admin/roles/unpublish/route.ts
//
// Unpublish is a SEPARATE safety capability (Plan B item 3, plan
// §"Unpublish is a separate safety capability"). It deliberately does not use
// publish readiness or override eligibility at all:
//
//   { roles: [{ id, rev }] }                 // hide these published services
//   { mode: "recover", roles: [{ id }] }     // READ ONLY outcome verification
//
// A published service may be hidden even when its team, availability, setlist or
// proposal is unsafe, incomplete, conflicted, invalid or unavailable — that is
// precisely when hiding it matters. No blocker acknowledgements are accepted, and
// no member / setlist / proposal observation is required or read.
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
// unpublish is silent by design (A2 §7) — only a real `false -> true` notifies.

import { NextRequest, NextResponse } from "next/server";

import { requireActiveManager } from "@/app/utils/authGuards";
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
  type RoleWriteTarget,
} from "@/app/utils/roleWriteOps";
import {
  allObservedIn,
  observePublicationStates,
  parseUnpublishRequest,
} from "@/app/utils/publishReadyBundle";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

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
  const parsed = parseUnpublishRequest(body);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const { mode, entries } = parsed.value;

  // Only these three stored types have a service publication state at all.
  const PUBLISHABLE_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;

  // ── Recovery for a lost/unknown response: refetch identity + state only ────
  if (mode === "recover") {
    const observed = await observePublicationStates(entries.map((e) => e.id));
    if (!observed.ok) {
      return NextResponse.json(
        {
          error: "unknown_outcome",
          outcome: "unknown",
          message: "No se pudo confirmar el resultado. Vuelve a intentar la verificación.",
        },
        { status: 503 },
      );
    }
    if (allObservedIn(observed.states, "draft")) {
      // Already hidden: recovered success, with no second mutation.
      return NextResponse.json({ ok: true, mode, outcome: "recovered", services: observed.states });
    }
    return reject(
      serviceError("stale_revision", {
        message: "El resultado no coincide con lo solicitado. Recarga y vuelve a intentar.",
        details: { outcome: "not_in_requested_state", services: observed.states },
      }),
    );
  }

  // ── Narrow safe-targeting proof, per role ─────────────────────────────────
  const targets: RoleWriteTarget[] = [];
  for (const entry of entries) {
    const load = await loadRoleForWrite(entry.id, entry.rev);
    if (!load.ok) {
      return reject(serviceError(load.failure.code, { details: load.failure.details }));
    }
    const target = load.target;
    if (!(PUBLISHABLE_TYPES as readonly string[]).includes(target.role._type)) {
      return reject(
        serviceError("integrity_conflict", {
          details: { id: entry.id, detail: "unexpected_type" },
        }),
      );
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
      return reject(
        serviceError("ambiguous_target", {
          details: {
            id: entry.id,
            targetKey: target.targetKey,
            conflictingIds: occupancy.canonicalRoleIds,
          },
        }),
      );
    }
    if (occupancy.rawDraftIds.length > 0) {
      return reject(
        serviceError("integrity_conflict", {
          details: { id: entry.id, rawDrafts: occupancy.rawDraftIds },
        }),
      );
    }
    targets.push(target);
  }

  // Weekend lock ownership (A2 §1). A wrong-owner, vacant or malformed token is an
  // integrity conflict and is never implicitly reclaimed.
  const coordination = await resolveOwnedCoordination(targets);
  if (!coordination.ok) {
    return reject(
      serviceError(coordination.failure.code, { details: coordination.failure.details }),
    );
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
      return reject(
        serviceError(coordination.bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
          details: { ids: toPatch },
        }),
      );
    }
    // Member-facing caches must drop the hidden service promptly.
    revalidateRolePublication();
  }

  return NextResponse.json({
    ok: true,
    unpublished: toPatch.length,
    services: roles.map((r) => ({ id: r.role._id })),
  });
}
