import { NextRequest, NextResponse } from "next/server";

// The post-commit `after()` fan-out queues the debounced lead-notes notice and
// (from Task 11) hosts a sweep; give it room to finish past the response.
export const maxDuration = 60;

import { requireMinistryMember } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import {
  notifyProposalPending,
  queueLeadNotesNotice,
} from "@/app/utils/serviceMutationSideEffects";
import { mergeContributor, type StoredContributor } from "@/app/utils/proposalContributors";
import { serviceError } from "@/app/utils/serviceMutation";
import { canonicalLeadRefs, pickUnique } from "@/app/utils/serviceReadSelect";
import { canonicalProposalByIdQuery } from "@/app/utils/serviceReadQueries";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { loadCanonicalRole, nextKey, nowIso } from "@/app/utils/roleWriteOps";
import { loadProposalGroup, loadWeekendCoordination } from "@/app/utils/serviceWriteTargets";
import { buildProposalSongDocs, compareObservedTarget } from "@/app/utils/setlistWriteRequest";
import {
  deterministicProposalId,
  parseProposalSaveRequest,
  targetFromCanonicalRole,
} from "@/app/utils/proposalWriteRequest";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/** Contributors as `mergeContributor` expects them (the projection flattens `person`). */
function storedContributors(value: unknown): StoredContributor[] {
  if (!Array.isArray(value)) return [];
  const out: StoredContributor[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as { _key?: unknown; person?: unknown };
    if (typeof row._key !== "string" || !row._key) continue;
    const ref = typeof row.person === "string" ? row.person : (row.person as { _ref?: string } | null)?._ref;
    out.push({ _key: row._key, ...(ref ? { person: { _ref: ref } } : {}) });
  }
  return out;
}

// GET /api/me/proposals — the shared proposal for every service the current user
// is a Lead on (not only ones they authored). Mirrors the /me superset.
export async function GET() {
  // Setlist proposals are a worship surface; membership, not just a session.
  const session = await requireMinistryMember("worship");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // GET reads through the canonical (published-perspective) client so a
  // `drafts.*` proposal/role overlay can never surface in a member's list.
  const proposals = await operationalClient.fetch(
    `*[_type == "setlistProposal" && $id in service_ref->Lead[]._ref] | order(service_date asc) {
      _id, _rev, service_type, service_date, status, lead_notes, team_notes, admin_notes, submitted_at, reviewed_at,
      "service_ref": service_ref._ref
    }`,
    { id: session.user.sanityId }
  );

  return NextResponse.json(proposals);
}

/**
 * Create / save / resubmit the ONE shared proposal for a service (A2 §6).
 *
 * Body: `{ roleId, observed, songs, leadNotes?, teamNotes?, status: "draft" | "pending" }`
 *
 * - The service target (type + date) is refreshed from the AUTHORIZED canonical
 *   role; it is never accepted from the client.
 * - The existing proposal is resolved through A1's two indexes (`service_ref` and
 *   target key), never an arbitrary `order()[0]`, and a duplicate/ambiguous group
 *   or a raw draft is `409` with no write.
 * - When a proposal exists, the EXACT observed id + revision is required; when
 *   none exists, only a deterministic-id create is permitted — that id is the
 *   first-create mutex between two co-leads.
 * - The weekend target lock (or the special role's own revision) is asserted in
 *   the SAME transaction.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const POST = withVerificationRunContext(postHandler);

async function postHandler(req: NextRequest) {
  // Defence in depth — the canonical-role check below already requires the
  // caller to be a Lead on the service — but a worship write stays behind
  // worship membership regardless.
  const session = await requireMinistryMember("worship");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const parsed = parseProposalSaveRequest(raw);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;
  const leadId = session.user.sanityId;

  // ── Authorize against the canonical role, and derive the target from it ────
  const lookup = await loadCanonicalRole(request.roleId);
  if (lookup.state === "none") {
    return NextResponse.json({ error: "Not a Lead on this service" }, { status: 403 });
  }
  if (lookup.state !== "single" || !lookup.role) {
    return reject(
      serviceError("ambiguous_target", { details: { roleId: request.roleId, state: lookup.state } }),
    );
  }
  if (lookup.draftIds.length) {
    return reject(
      serviceError("integrity_conflict", {
        details: { roleId: request.roleId, rawDrafts: lookup.draftIds },
      }),
    );
  }
  const role = lookup.role;
  // Member-facing gate: an admin-only draft service is not proposable.
  if (role.published === false || !canonicalLeadRefs(role).includes(leadId)) {
    return NextResponse.json({ error: "Not a Lead on this service" }, { status: 403 });
  }
  const target = targetFromCanonicalRole(role);
  if (!target) {
    return reject(
      serviceError("integrity_conflict", { details: { roleId: request.roleId, detail: "role_target" } }),
    );
  }

  // ── Resolve the shared proposal through BOTH indexes ──────────────────────
  const group = await loadProposalGroup({
    roleId: target.serviceRef,
    serviceDate: target.serviceDate,
    targetKey: target.targetKey,
  });
  if (!group.ok) {
    return reject(serviceError(group.failure.code, { details: group.failure.details }));
  }
  const existing = group.group.existing;
  const server = existing
    ? { state: "single" as const, id: existing._id as string, rev: existing._rev as string }
    : { state: "none" as const };

  const mismatch = compareObservedTarget(request.observed, server);
  if (mismatch) {
    return reject(
      serviceError("stale_revision", {
        details: { detail: mismatch, roleId: target.serviceRef, observed: request.observed, server },
      }),
    );
  }

  // An approved shared proposal already wrote the live setlist; re-opening it is
  // an admin-only transition, never a member save.
  if (existing && existing.status === "approved") {
    return reject(
      serviceError("stale_revision", {
        message: "Esta propuesta ya fue aprobada. Recarga para ver el setlist publicado.",
        details: { detail: "approved", proposalId: existing._id },
      }),
    );
  }

  // ── Coordination token ────────────────────────────────────────────────────
  let lockOp: { id: string; rev: string } | null = null;
  let bootstrapped = false;
  if (target.serviceType === "special") {
    // The special role is its own coordination token: assert its revision with a
    // no-op heartbeat of the unchanged date field, in the business transaction.
    lockOp = null;
  } else {
    const coordination = await loadWeekendCoordination({
      roleType: target.serviceType === "sunday" ? "sunday_role" : "saturday_role",
      week: target.serviceDate,
    });
    if (!coordination.ok) {
      return reject(
        serviceError(coordination.failure.code, { details: coordination.failure.details }),
      );
    }
    if (coordination.coordination.role?._id !== role._id) {
      return reject(
        serviceError("integrity_conflict", {
          details: { roleId: role._id, detail: "target_owner_mismatch" },
        }),
      );
    }
    bootstrapped = coordination.coordination.bootstrapped;
    const lock = coordination.coordination.lock;
    if (lock) lockOp = { id: lock._id, rev: lock._rev };
  }

  // ── One guarded transaction ───────────────────────────────────────────────
  const now = nowIso();
  // The outbox `leadNotes` snapshot, captured PRE-COMMIT from the proposal this
  // handler already loaded (§2). Read back inside the post-commit `after()` block
  // both would be the notes this save just wrote, so every notice would compare a
  // value against itself and say nothing.
  const previousStatus = existing ? existing.status : null;
  const beforeNotes = existing ? existing.lead_notes : "";
  const songs = buildProposalSongDocs(request.songs, nextKey);
  const submitted: Record<string, unknown> =
    request.status === "pending"
      ? { submitted_at: now, submitted_by: { _type: "reference", _ref: leadId } }
      : {};

  let proposalId: string;
  let tx = writeClient.transaction();

  if (existing) {
    proposalId = existing._id as string;
    // Equal to the client-observed revision — `compareObservedTarget` above
    // already refused anything else.
    const rev = existing._rev as string;
    const contributors = mergeContributor(
      storedContributors(existing.contributors),
      leadId,
      nextKey,
    );
    // `_type` is never sent: it is immutable per document id.
    tx = tx.patch(proposalId, (p) =>
      p.ifRevisionId(rev).set({
        songs,
        status: request.status,
        lead_notes: request.leadNotes,
        team_notes: request.teamNotes,
        contributors,
        // Target metadata refreshed from the authorized canonical role.
        service_type: target.serviceType,
        service_date: target.serviceDate,
        last_edited_by: { _type: "reference", _ref: leadId },
        last_edited_at: now,
        ...submitted,
      }),
    );
  } else {
    const deterministic = deterministicProposalId(target.serviceRef);
    if (!deterministic) {
      return reject(serviceError("invalid_request", { details: { issues: ["roleId"] } }));
    }
    proposalId = deterministic;
    // `create` (never `createIfNotExists`): the co-lead who loses the race is TOLD.
    const created: Record<string, unknown> & { _id: string; _type: string } = {
      _id: deterministic,
      _type: "setlistProposal",
      service_type: target.serviceType,
      service_ref: { _type: "reference", _ref: target.serviceRef },
      service_date: target.serviceDate,
      lead: { _type: "reference", _ref: leadId },
      contributors: [
        { _type: "contributor", _key: nextKey(), person: { _type: "reference", _ref: leadId } },
      ],
      last_edited_by: { _type: "reference", _ref: leadId },
      last_edited_at: now,
      songs,
      status: request.status,
      lead_notes: request.leadNotes,
      team_notes: request.teamNotes,
      ...submitted,
    };
    tx = tx.create(created);
  }

  if (lockOp) {
    const lockRev = lockOp.rev;
    tx = tx.patch(lockOp.id, (p) => p.ifRevisionId(lockRev).set({ updatedAt: now }));
  } else if (target.serviceType === "special") {
    const roleRev = role._rev;
    tx = tx.patch(role._id, (p) => p.ifRevisionId(roleRev).set({ date: target.serviceDate }));
  }

  try {
    await tx.commit();
  } catch (err) {
    const kind = sanityConflictKind(err);
    if (!kind) throw err;
    return reject(
      serviceError(bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
        details: {
          roleId: target.serviceRef,
          detail: kind === "already_exists" ? "concurrent_creation" : "revision_moved",
        },
      }),
    );
  }

  // Post-commit side effect (§7): only a proposal committed as `pending` notifies
  // — the existing admin/co-lead push plus the allowlist- and preference-aware
  // admin email. A draft save is silent, and a failed notification never fails
  // the write that already committed.
  if (request.status === "pending") {
    await notifyProposalPending({
      leadId,
      roleId: target.serviceRef,
      proposalId,
      serviceType: target.serviceType as "sunday" | "saturday" | "special",
      serviceDate: target.serviceDate,
    });
  }
  // The DEBOUNCED lead-notes email (§2). The predicate is that the proposal was
  // ALREADY `pending` / `changes_requested` before this write — a first
  // submission is silent, because `notifyProposalPending` above just mailed
  // admins "Nueva propuesta" about that very same write.
  queueLeadNotesNotice({
    proposalId,
    serviceDate: target.serviceDate,
    previousStatus,
    beforeNotes,
    afterNotes: request.leadNotes,
  });

  // Return the fresh revision so the client can keep editing without a reload.
  const bound = canonicalProposalByIdQuery(proposalId);
  const fresh = pickUnique(
    await operationalClient.fetch<{ _rev?: string }[]>(bound.query, bound.params),
  );
  return NextResponse.json({
    _id: proposalId,
    _rev: fresh?._rev ?? null,
    status: request.status,
  });
}
