import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import {
  notifyProposalReview,
  revalidateProposalApproval,
} from "@/app/utils/serviceMutationSideEffects";
import { serviceError } from "@/app/utils/serviceMutation";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { nextKey, nowIso, type StoredLock } from "@/app/utils/roleWriteOps";
import {
  loadCanonicalProposal,
  loadProposalGroup,
  loadSpecialSetlistTarget,
  loadWeekendCoordination,
  loadWeekendSetlistTarget,
} from "@/app/utils/serviceWriteTargets";
import {
  buildSetlistSongDocs,
  buildWeekendSetlistDocument,
  type WeekendSetlistType,
} from "@/app/utils/setlistWriteRequest";
import {
  approvalInputFingerprint,
  buildApprovalReceipt,
  buildTransitionRecord,
  decideApprovalReceipt,
  decideTransitionRetry,
  isAllowedSourceStatus,
  parseProposalTransitionRequest,
  storedProposalSongRows,
  targetFromCanonicalRole,
  type ApprovalInput,
  type ProposalAction,
  type TransitionIntent,
} from "@/app/utils/proposalWriteRequest";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

const REVIEW_PUSH: Record<string, { title: string; body: string }> = {
  approve: { title: "Propuesta aprobada", body: "La propuesta de setlist fue aprobada." },
  request_changes: { title: "Cambios solicitados", body: "Revisaron la propuesta y pidieron cambios." },
  reopen: { title: "Propuesta reabierta", body: "Un admin reabrió el setlist para ajustes." },
};

const STALE_MESSAGE =
  "La propuesta cambió mientras la revisabas. Recárgala y vuelve a revisar.";

/**
 * Guarded proposal transitions (A2 §6): `approve`, `request_changes`, `reopen`
 * and `reconcile_target`.
 *
 * Body: `{ action, rev, adminNotes? }` where `rev` is the proposal revision the
 * admin ACTUALLY reviewed — a freshly fetched server revision is never a
 * substitute, because it would re-authorize a decision made against content the
 * reviewer never saw.
 *
 * Every action resolves the proposal through the canonical contract (exactly one
 * document, no raw draft, a resolvable canonical role), validates the source
 * state and the transition/approval fingerprint, and commits ONE transaction that
 * asserts the proposal revision plus the weekend lock or the special role. A
 * matching already-committed transition (or approval receipt) is an explicit
 * no-write retry; every mismatch is a `409` that preserves the reviewed card and
 * requires a reload.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const PATCH = withVerificationRunContext(patchHandler);

async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const parsed = parseProposalTransitionRequest(raw);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;

  // Only the guarded retarget may load a proposal whose stored target drifted
  // from its role — repairing exactly that drift is what it is for.
  const reconciling = request.action === "reconcile_target";
  const loaded = await loadCanonicalProposal(
    id,
    reconciling ? ["date_mismatch", "role_type_mismatch"] : [],
  );
  if (!loaded.ok) {
    return reject(serviceError(loaded.failure.code, { details: loaded.failure.details }));
  }
  const { doc, validation, role } = loaded.proposal;
  const target = targetFromCanonicalRole(role);
  if (!target) {
    return reject(
      serviceError("integrity_conflict", { details: { id, roleId: role._id, detail: "role_target" } }),
    );
  }
  // The proposal's own stored target must agree with the authorized canonical
  // role; a disagreement is reconciled explicitly, never silently published.
  if (!reconciling && validation.targetKey !== target.targetKey) {
    return reject(
      serviceError("integrity_conflict", {
        details: {
          id,
          storedTargetKey: validation.targetKey,
          canonicalTargetKey: target.targetKey,
          detail: "target_drift",
        },
      }),
    );
  }

  const now = nowIso();
  const reviewerId = typeof session.user.sanityId === "string" ? session.user.sanityId : null;

  if (request.action === "approve") {
    return approve({ id, doc, validation, role, target, request, now, reviewerId });
  }
  return transition({ id, doc, target, request, now, reviewerId });
}

// ── Approval ────────────────────────────────────────────────────────────────

type ApproveArgs = {
  id: string;
  doc: Record<string, unknown>;
  validation: { contentState: string };
  role: { _id: string; _rev: string; _type: string; date?: string };
  target: ReturnType<typeof targetFromCanonicalRole> & object;
  request: { action: ProposalAction; rev: string; adminNotes: string };
  now: string;
  reviewerId: string | null;
};

async function approve(args: ApproveArgs) {
  const { id, doc, target, request, now, reviewerId } = args;

  const songRows = storedProposalSongRows(doc.songs);
  if (!songRows) {
    return reject(
      serviceError("integrity_conflict", { details: { id, detail: "proposal_songs_malformed" } }),
    );
  }
  const teamNotes = typeof doc.team_notes === "string" ? doc.team_notes : "";
  const approval: ApprovalInput = {
    serviceType: target.serviceType,
    serviceDate: target.serviceDate,
    serviceRef: target.serviceRef,
    setlistTargetKey: target.setlistTargetKey,
    songs: songRows,
    teamNotes,
  };
  const fingerprint = approvalInputFingerprint(approval);

  // ── Already approved: receipt decides (retry vs legacy vs drift) ──────────
  if (doc.status === "approved") {
    const decision = decideApprovalReceipt({
      receipt: doc.approval_receipt,
      fingerprint,
      serviceRef: target.serviceRef,
      setlistTargetKey: target.setlistTargetKey,
    });
    if (decision === "verified") {
      // Lost-response replay: no write, no notification, no revalidation.
      return NextResponse.json({ ok: true, status: "approved", idempotent: true });
    }
    if (decision === "unverified") {
      return reject(
        serviceError("legacy_approval_unverified", { details: { id, detail: "no_valid_receipt" } }),
      );
    }
    return reject(
      serviceError("integrity_conflict", {
        details: { id, detail: "approval_fingerprint_mismatch" },
      }),
    );
  }

  if (!isAllowedSourceStatus("approve", doc.status)) {
    return reject(
      serviceError("stale_revision", {
        message: STALE_MESSAGE,
        details: { id, detail: "source_status", status: doc.status },
      }),
    );
  }
  if (doc._rev !== request.rev) {
    return reject(
      serviceError("stale_revision", {
        message: STALE_MESSAGE,
        details: { id, storedRev: doc._rev, observedRev: request.rev },
      }),
    );
  }
  if (args.validation.contentState !== "ready") {
    return reject(
      serviceError("integrity_conflict", {
        message: "La propuesta no está lista para publicarse.",
        details: { id, contentState: args.validation.contentState },
      }),
    );
  }

  // No duplicate/ambiguous group: this proposal must be THE shared proposal for
  // its service on BOTH of A1's indexes before its content becomes the setlist.
  const group = await loadProposalGroup({
    roleId: target.serviceRef,
    serviceDate: target.serviceDate,
    targetKey: target.targetKey,
  });
  if (!group.ok) {
    return reject(serviceError(group.failure.code, { details: group.failure.details }));
  }
  if (group.group.existing?._id !== id) {
    return reject(
      serviceError("ambiguous_target", {
        details: { id, sharedProposalId: group.group.existing?._id ?? null, detail: "not_shared_proposal" },
      }),
    );
  }

  // ── Resolve the live setlist target and the coordination token ────────────
  const songs = buildSetlistSongDocs(songRows, nextKey);
  const special = target.serviceType === "special";
  let lock: StoredLock | null = null;
  let bootstrapped = false;
  let setlistId: string;
  /** The op that writes the live setlist, applied inside the ONE transaction. */
  let writeSetlist: (tx: ReturnType<typeof writeClient.transaction>) => ReturnType<typeof writeClient.transaction>;

  if (special) {
    const targetLoad = await loadSpecialSetlistTarget(target.serviceRef, target.serviceDate);
    if (!targetLoad.ok) {
      return reject(serviceError(targetLoad.failure.code, { details: targetLoad.failure.details }));
    }
    const specialRole = targetLoad.target.role;
    setlistId = specialRole._id;
    const roleRev = specialRole._rev;
    // The special role IS the live setlist target: its revision assertion both
    // publishes the songs and serializes the service.
    writeSetlist = (tx) =>
      tx.patch(specialRole._id, (p) =>
        p.ifRevisionId(roleRev).set({ songs, team_notes: teamNotes }),
      );
  } else {
    const setlistType: WeekendSetlistType =
      target.serviceType === "sunday" ? "featuredSongs" : "saturdarSongs";
    const targetLoad = await loadWeekendSetlistTarget(setlistType, target.serviceDate);
    if (!targetLoad.ok) {
      return reject(serviceError(targetLoad.failure.code, { details: targetLoad.failure.details }));
    }
    const observed = targetLoad.target.server;
    const coordination = await loadWeekendCoordination({
      roleType: target.serviceType === "sunday" ? "sunday_role" : "saturday_role",
      week: target.serviceDate,
    });
    if (!coordination.ok) {
      return reject(
        serviceError(coordination.failure.code, { details: coordination.failure.details }),
      );
    }
    if (coordination.coordination.role?._id !== target.serviceRef) {
      return reject(
        serviceError("integrity_conflict", {
          details: { id, detail: "target_owner_mismatch" },
        }),
      );
    }
    lock = coordination.coordination.lock;
    bootstrapped = coordination.coordination.bootstrapped;

    if (observed.state === "single") {
      setlistId = observed.id;
      const rev = observed.rev;
      writeSetlist = (tx) =>
        tx.patch(observed.id, (p) => p.ifRevisionId(rev).set({ songs, team_notes: teamNotes }));
    } else {
      const doc = buildWeekendSetlistDocument({
        setlistType,
        week: target.serviceDate,
        songs,
        teamNotes,
      });
      if (!doc) {
        return reject(serviceError("integrity_conflict", { details: { id, detail: "setlist_id" } }));
      }
      setlistId = doc._id;
      writeSetlist = (tx) => tx.create(doc);
    }
  }

  const receipt = buildApprovalReceipt({ approval, setlistId, now, approvedBy: reviewerId });
  if (!receipt) {
    return reject(serviceError("integrity_conflict", { details: { id, detail: "receipt_build" } }));
  }

  // ── ONE transaction: proposal + coordination + live setlist + receipt ─────
  const proposalRev = request.rev;
  let tx = writeClient.transaction();
  tx = tx.patch(id, (p) =>
    p.ifRevisionId(proposalRev).set({
      status: "approved",
      reviewed_at: now,
      approval_receipt: receipt,
    }),
  );
  tx = writeSetlist(tx);
  if (lock) {
    const lockRev = lock._rev;
    tx = tx.patch(lock._id, (p) => p.ifRevisionId(lockRev).set({ updatedAt: now }));
  }

  try {
    await tx.commit();
  } catch (err) {
    const kind = sanityConflictKind(err);
    if (!kind) throw err;
    return reject(
      serviceError(bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
        message: STALE_MESSAGE,
        details: {
          id,
          detail: kind === "already_exists" ? "concurrent_creation" : "revision_moved",
        },
      }),
    );
  }

  // ── Post-commit side effects (§7), all through the one shared module ───────
  // Review recipients come from the canonical proposal this request already
  // loaded (creator + contributors), never a client list.
  await notifyProposalReview(doc, REVIEW_PUSH.approve);
  // The approved proposal just wrote the real setlist — refresh the cached
  // home/schedule/song pages so it shows without waiting for ISR expiry.
  revalidateProposalApproval();
  return NextResponse.json({ ok: true, status: "approved", setlistId });
}

// ── request_changes / reopen / reconcile_target ─────────────────────────────

type TransitionArgs = {
  id: string;
  doc: Record<string, unknown>;
  target: ReturnType<typeof targetFromCanonicalRole> & object;
  request: { action: ProposalAction; rev: string; adminNotes: string };
  now: string;
  reviewerId: string | null;
};

async function transition(args: TransitionArgs) {
  const { id, doc, target, request, now, reviewerId } = args;
  const action = request.action;
  const reconcile = action === "reconcile_target";
  // A retarget changes metadata, not status, so its intent records the unchanged
  // status; the other two transitions commit `changes_requested`.
  const toStatus = reconcile ? String(doc.status ?? "") : "changes_requested";
  const intent: TransitionIntent = {
    action,
    proposalId: id,
    toStatus,
    adminNotes: request.adminNotes,
    targetIdentity: reconcile ? target.targetKey : null,
  };

  // An already-committed identical transition is an explicit no-write retry: the
  // reviewed revision has necessarily moved, so the recorded intent is the proof.
  if (
    decideTransitionRetry({
      storedStatus: doc.status,
      storedTransition: doc.last_transition,
      intent,
    }) === "no_write_retry"
  ) {
    return NextResponse.json({ ok: true, status: doc.status, idempotent: true });
  }

  if (!isAllowedSourceStatus(action, doc.status)) {
    return reject(
      serviceError("stale_revision", {
        message: STALE_MESSAGE,
        details: { id, detail: "source_status", status: doc.status },
      }),
    );
  }
  if (doc._rev !== request.rev) {
    return reject(
      serviceError("stale_revision", {
        message: STALE_MESSAGE,
        details: { id, storedRev: doc._rev, observedRev: request.rev },
      }),
    );
  }

  // Coordination: the weekend lock, or the special role's own revision.
  let lock: StoredLock | null = null;
  let bootstrapped = false;
  let specialRole: { _id: string; _rev: string; date: string } | null = null;
  if (target.serviceType === "special") {
    const targetLoad = await loadSpecialSetlistTarget(target.serviceRef, target.serviceDate);
    if (!targetLoad.ok) {
      return reject(serviceError(targetLoad.failure.code, { details: targetLoad.failure.details }));
    }
    specialRole = {
      _id: targetLoad.target.role._id,
      _rev: targetLoad.target.role._rev,
      date: target.serviceDate,
    };
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
    if (coordination.coordination.role?._id !== target.serviceRef) {
      return reject(
        serviceError("integrity_conflict", { details: { id, detail: "target_owner_mismatch" } }),
      );
    }
    lock = coordination.coordination.lock;
    bootstrapped = coordination.coordination.bootstrapped;
  }

  const record = buildTransitionRecord({ intent, now, by: reviewerId });
  const set: Record<string, unknown> = reconcile
    ? {
        // Target metadata refreshed from the authorized canonical role.
        service_type: target.serviceType,
        service_date: target.serviceDate,
        last_transition: record,
      }
    : {
        status: "changes_requested",
        admin_notes: request.adminNotes,
        reviewed_at: now,
        last_transition: record,
      };

  const proposalRev = request.rev;
  let tx = writeClient.transaction().patch(id, (p) => p.ifRevisionId(proposalRev).set(set));
  if (lock) {
    const lockRev = lock._rev;
    tx = tx.patch(lock._id, (p) => p.ifRevisionId(lockRev).set({ updatedAt: now }));
  } else if (specialRole) {
    const roleRev = specialRole._rev;
    const roleDate = specialRole.date;
    tx = tx.patch(specialRole._id, (p) => p.ifRevisionId(roleRev).set({ date: roleDate }));
  }

  try {
    await tx.commit();
  } catch (err) {
    const kind = sanityConflictKind(err);
    if (!kind) throw err;
    return reject(
      serviceError(bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
        message: STALE_MESSAGE,
        details: { id, detail: kind === "already_exists" ? "concurrent_creation" : "revision_moved" },
      }),
    );
  }

  // Post-commit side effect (§7): `request_changes` / `reopen` push to the
  // review recipients. `reconcile_target` is metadata repair and stays silent.
  const push = REVIEW_PUSH[action];
  if (push) await notifyProposalReview(doc, push);

  return NextResponse.json({
    ok: true,
    status: reconcile ? doc.status : "changes_requested",
    ...(reconcile ? { targetKey: target.targetKey } : {}),
  });
}
