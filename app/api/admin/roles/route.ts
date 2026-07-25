import { NextRequest, NextResponse, after } from "next/server";

export const maxDuration = 60;
import { randomUUID } from "node:crypto";
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { sendPush } from "@/app/utils/push";
import { sendAssignmentEmails } from "@/app/utils/assignmentEmail";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { revalidatePath } from "next/cache";
import { serviceDependencyError, serviceError } from "@/app/utils/serviceMutation";
import { buildCreationReceipt } from "@/app/utils/roleCreationReceipt";
import { buildClaimedLock, claimLockPatch } from "@/app/utils/roleTargetLock";
import {
  buildRoleDocument,
  decideReceipt,
  parseCreateRequest,
  planTargetClaim,
  sanityConflictKind,
  seatAssignees,
  type ParsedCreateRequest,
} from "@/app/utils/roleWriteRequest";
import {
  loadCanonicalRole,
  loadDependencies,
  loadLock,
  loadReceiptById,
  loadTargetOccupancy,
  nextKey,
  nowIso,
  type StoredReceipt,
} from "@/app/utils/roleWriteOps";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

export async function GET() {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const SONG_PROJ = `{ _id, title, author, key, "slug": slug.current }`;
  const SETLIST_SONGS = `songs[]{ play_key, medley_tag, "song": song->${SONG_PROJ} }`;

  const roles = await operationalClient.fetch(`
    *[_type in ["sunday_role", "saturday_role", "special_role"]]
    | order(coalesce(week, date) asc) {
      _id, _rev, _type, service_name, published,
      "date": coalesce(week, date),
      "leads": Lead[]->{_id, member_name, alias},
      "bgvs": BGVs[]->{_id, member_name, alias},
      "chorus": Chorus[]->{_id, member_name, alias},
      "instruments": instruments[]{instrument, "person": person->{_id, member_name, alias}},
      "foh": foh_team[]{role, "person": person->{_id, member_name, alias}},
      "songs": coalesce(select(
        _type == "sunday_role"   => *[_type == "featuredSongs"  && week == ^.week][0].${SETLIST_SONGS},
        _type == "saturday_role" => *[_type == "saturdarSongs"  && week == ^.week][0].${SETLIST_SONGS},
        ${SETLIST_SONGS}
      ), [])
    }
  `);

  return NextResponse.json(roles);
}

/**
 * Create one service role (A2 §2).
 *
 * The deterministic `roleCreationReceipt` is the global create-request mutex
 * across every role type and target; the weekend `roleTargetLock` independently
 * serializes DIFFERENT request ids competing for one weekend target. A lost
 * response replays as idempotent success with no writes, notifications, or
 * revalidation; the same key with a different payload is `409
 * idempotency_mismatch`, and a retired key can never recreate its role.
 */
export async function POST(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }

  const parsed = parseCreateRequest(body);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;

  // Whitelist the service doc types this route may create — never trust an
  // arbitrary caller-supplied _type into a create transaction.
  const ALLOWED_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;
  if (!(ALLOWED_TYPES as readonly string[]).includes(request.roleType)) {
    return reject(serviceError("invalid_request", { details: { issues: ["_type"] } }));
  }

  // ── Existing receipt: lost-response replay, mismatch, or retired key ──────
  const existing = await loadReceiptById(request.receiptId);
  if (existing) {
    return resolveExistingReceipt(existing, request);
  }

  // ── First attempt: inventory the target before writing anything ───────────
  const occupancy = await loadTargetOccupancy({
    roleType: request.roleType,
    date: request.date,
    serviceName: request.serviceName,
  });
  if (occupancy.rawDraftIds.length) {
    return reject(
      serviceError("integrity_conflict", {
        details: { targetKey: request.targetKey, rawDrafts: occupancy.rawDraftIds },
      }),
    );
  }
  if (occupancy.canonicalRoleIds.length) {
    return reject(
      serviceError("ambiguous_target", {
        message: "Ya existe un servicio en esta fecha para este tipo.",
        details: { targetKey: request.targetKey, roleIds: occupancy.canonicalRoleIds },
      }),
    );
  }

  const dependencies = await loadDependencies({
    operation: "create",
    target: { roleType: request.roleType, date: request.date },
  });
  if (!dependencies.usable) {
    return reject(
      serviceError("integrity_conflict", { details: { dependencyIssues: dependencies.issues } }),
    );
  }
  if (dependencies.hasDependencies) {
    return reject(serviceDependencyError(dependencies.code, dependencies.dependencies));
  }

  // ── Weekend lock plan (special services take no lock) ─────────────────────
  const lock = await loadLock(request.lockId);
  let claim: ReturnType<typeof planTargetClaim> | null = null;
  if (request.lockId) {
    claim = planTargetClaim({
      lock,
      targetKey: `${request.roleType}:${request.date}`,
      ownerExists: undefined,
    });
    if (claim.kind === "integrity") {
      return reject(
        serviceError("integrity_conflict", {
          details: { lockId: request.lockId, detail: claim.detail },
        }),
      );
    }
    if (claim.kind === "occupied") {
      // The canonical target was proven empty above, so a still-claimed lock is
      // a wrong-owner/orphan integrity issue. It is never reclaimed implicitly.
      return reject(
        serviceError("integrity_conflict", {
          details: {
            lockId: request.lockId,
            ownerRoleId: claim.roleId,
            detail: "lock_claimed_without_canonical_owner",
          },
        }),
      );
    }
  }

  const roleId = randomUUID();
  const now = nowIso();
  const receipt = buildCreationReceipt({
    requestId: request.requestId,
    payload: body as Parameters<typeof buildCreationReceipt>[0]["payload"],
    roleId,
    now,
  });
  if (!receipt) {
    return reject(serviceError("invalid_request", { details: { issues: ["receipt"] } }));
  }
  const doc = buildRoleDocument({
    roleId,
    roleType: request.roleType,
    date: request.date,
    serviceName: request.serviceName,
    published: request.published,
    seats: request.seats,
    receiptId: request.receiptId,
    fingerprint: request.fingerprint,
    nextKey,
  });

  // One transaction: receipt + role (+ weekend claim). `create`, never
  // `createIfNotExists` — the id collision IS the cross-request mutex.
  let tx = writeClient.transaction().create(receipt).create(doc);
  if (claim?.kind === "create") {
    const lockDoc = buildClaimedLock({
      targetKey: `${request.roleType}:${request.date}`,
      roleId,
      claimNonce: randomUUID(),
      now,
    });
    if (!lockDoc) {
      return reject(serviceError("integrity_conflict", { details: { detail: "lock_build" } }));
    }
    tx = tx.create(lockDoc);
  } else if (claim?.kind === "reclaim") {
    const patch = claimLockPatch({ roleId, claimNonce: randomUUID(), now });
    tx = tx.patch(claim.lockId, (p) => p.ifRevisionId(claim.lockRev).set(patch.set));
  }

  try {
    await tx.commit();
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    // Never blindly retry: refetch the RECEIPT first, so a same-key winner is
    // reported as replay/mismatch rather than as a target conflict.
    const raced = await loadReceiptById(request.receiptId);
    if (raced) return resolveExistingReceipt(raced, request);
    const afterState = await loadTargetOccupancy({
      roleType: request.roleType,
      date: request.date,
      serviceName: request.serviceName,
    });
    if (afterState.canonicalRoleIds.length || afterState.rawDraftIds.length) {
      return reject(
        serviceError("ambiguous_target", {
          details: { targetKey: request.targetKey, roleIds: afterState.canonicalRoleIds },
        }),
      );
    }
    return reject(serviceError("stale_revision", { details: { targetKey: request.targetKey } }));
  }

  // ISR invalidation: a newly created service must appear on the schedule/home
  // and /me views immediately. Drafts still revalidate — they surface in the
  // admin (Editar) views.
  revalidateServiceViews();
  revalidatePath("/me");

  // Recipients derive from the seats actually committed, across all five paths.
  const notifyBody = {
    leads: request.seats.leads,
    bgvs: request.seats.bgvs,
    chorus: request.seats.chorus,
    instruments: request.seats.instruments,
    foh: request.seats.foh,
  };
  const added = seatAssignees(request.seats);
  if (request.published) {
    after(async () => {
      await sendPush(added, "assignments", {
        title: "Nuevo servicio asignado",
        body: `Te asignaron para el ${request.date}.`,
        path: "/me",
      });
      await sendAssignmentEmails(added, {
        type: request.roleType,
        date: request.date,
        body: notifyBody,
      });
    });
  }

  return NextResponse.json({ ...doc, creationRequestId: request.requestId }, { status: 201 });
}

/**
 * Apply the §2 receipt rules to an existing receipt at this request's
 * deterministic id. A replay returns the committed role with NO writes,
 * notifications, or revalidation.
 */
async function resolveExistingReceipt(receipt: StoredReceipt, request: ParsedCreateRequest) {
  const roleId = typeof receipt.roleId === "string" ? receipt.roleId : null;
  const lookup = roleId ? await loadCanonicalRole(roleId) : null;
  const decision = decideReceipt({
    receipt,
    requestId: request.requestId,
    fingerprint: request.fingerprint,
    role: lookup?.role ?? null,
  });
  if (decision.decision === "replay") {
    return NextResponse.json(
      { ...(lookup?.role as object), replay: true, creationRequestId: request.requestId },
      { status: 200 },
    );
  }
  if (decision.decision === "absent") {
    // Cannot happen (the receipt was fetched), but fail closed rather than
    // falling through into a second create.
    return reject(serviceError("integrity_conflict", { details: { detail: "receipt_vanished" } }));
  }
  return reject(
    serviceError(decision.decision, {
      details: { receiptId: request.receiptId, roleId, detail: decision.detail },
    }),
  );
}
