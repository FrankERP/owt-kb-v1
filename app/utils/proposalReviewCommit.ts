// The proposal-decision writer (A2 §6) — the domain body of
// `PATCH /api/admin/proposals/[id]`, moved here so the MCP proposal tools call the
// very same code path (admin parity phase 3, S1; ADR-0043). The route keeps only
// its authorization prefix and JSON parse.
//
// Body: `{ action, rev, adminNotes? }` where `rev` is the proposal revision the
// admin ACTUALLY reviewed — a freshly fetched server revision is never a
// substitute, because it would re-authorize a decision made against content the
// reviewer never saw.
//
// Every action resolves the proposal through the canonical contract (exactly one
// document, no raw draft, a resolvable canonical role), validates the source
// state and the transition/approval fingerprint, and commits ONE transaction that
// asserts the proposal revision plus the weekend lock or the special role. A
// matching already-committed transition (or approval receipt) is an explicit
// no-write retry; every mismatch is a `409` that preserves the reviewed card and
// requires a reload.
//
// TWO MODES, ONE PLANNER. `planProposalReview` is the prefix the writer runs —
// load, drift, receipt/retry, status, revision, readiness, group, live target,
// coordination — never a copy of it. `"write"` is what `reviewProposal` uses;
// `"peek"` is the MCP check's (`check_setlist_proposal_review`): the same rules
// with the revision REPORTED instead of asserted, and the weekend coordination
// read through `peekWeekendCoordination`, which reports a legacy lock bootstrap
// (`needsBootstrap`) instead of committing it. Peek never writes.
//
// Boundary, and nothing else, differs from the route it came from: each refusal
// RETURNS `{ ok: false, status, body }` instead of sending it, success returns the
// same JSON as `body` plus `effects`, and a commit that fails for any reason other
// than a revision/creation conflict still THROWS, exactly as the route's 500 did.
//
// This module is a registered protected writer, its callers are pinned by
// `serviceCommitCallers.test.ts`, and it is a delivery-capable import for the
// SR-verification run-context scan. Adding a caller means touching that pin.

import "server-only";

import { writeClient } from "@/sanity/lib/serverClient";
import {
  notifyProposalReview,
  proposalReviewRecipients,
  queueSetlistNotice,
  revalidateProposalApproval,
  serviceParticipants,
  type SetlistNoticeDescriptor,
} from "@/app/utils/serviceMutationSideEffects";
import { serviceError } from "@/app/utils/serviceMutation";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { nextKey, nowIso, type StoredLock } from "@/app/utils/roleWriteOps";
import { buildProposalMessage } from "@/app/utils/proposalMessageWrite";
import {
  loadCanonicalProposal,
  loadProposalGroup,
  loadSpecialSetlistTarget,
  loadWeekendCoordination,
  loadWeekendSetlistTarget,
  peekWeekendCoordination,
  type WeekendCoordination,
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
import { isWorshipNight } from "@/app/utils/serviceFormat";
import { carryOverSongLeads, leadSeatIds } from "@/app/utils/songLeads";
import type { CommitOutcome } from "@/app/utils/commitOutcome";

const REVIEW_PUSH: Record<string, { title: string; body: string }> = {
  approve: { title: "Propuesta aprobada", body: "La propuesta de setlist fue aprobada." },
  request_changes: { title: "Cambios solicitados", body: "Revisaron la propuesta y pidieron cambios." },
  reopen: { title: "Propuesta reabierta", body: "Un admin reabrió el setlist para ajustes." },
};

const STALE_MESSAGE =
  "La propuesta cambió mientras la revisabas. Recárgala y vuelve a revisar.";

type Refusal = { ok: false; status: number; body: Record<string, unknown> };

function refuse(res: { status: number; body: unknown }): Refusal {
  return { ok: false, status: res.status, body: res.body as Record<string, unknown> };
}

export type ProposalReviewMode = "write" | "peek";

/** What the planner judges. `rev` is asserted in `"write"`; `"peek"` reports `doc._rev` instead. */
export interface ProposalReviewRequest {
  action: ProposalAction;
  rev: string | null;
  adminNotes: string;
}

type CanonicalTarget = NonNullable<ReturnType<typeof targetFromCanonicalRole>>;
type RoleTypeName = "sunday_role" | "saturday_role" | "special_role";

/** The live-setlist write an approval would make, applied inside the ONE transaction. */
export type SetlistWrite =
  | { kind: "patch"; id: string; rev: string }
  | { kind: "create"; doc: NonNullable<ReturnType<typeof buildWeekendSetlistDocument>> };

/**
 * The outbox `setlist` subject, captured PRE-COMMIT from the target the planner
 * has already loaded (§2). Its `roleId` is `target.serviceRef` — the SAME id the
 * manual writer derives from `loadWeekendCoordination(...).role`, because the
 * weekend branch refuses to proceed unless that coordination role IS
 * `target.serviceRef`. One service, one subject key, one email.
 */
export interface ProposalReviewSubject {
  published: unknown;
  beforeSongs: unknown;
  knownRecipients: string[];
}

interface PlanBase {
  id: string;
  doc: Record<string, unknown>;
  target: CanonicalTarget;
  /** The canonical service role the proposal resolved to (for a caller's label). */
  role: Record<string, unknown>;
  roleType: RoleTypeName;
  /** The proposal's revision as loaded: what a check reports for the write to assert. */
  docRev: string;
  /** Peek only: the first write would bootstrap the weekend's legacy lock and ask for a reload. */
  needsBootstrap: boolean;
}

/** An already-committed identical decision: the writer answers it as a no-write success. */
export interface ReplayPlan extends PlanBase {
  kind: "replay";
  status: string;
  /** The `status` the route's replay body carries: `"approved"`, or the stored status as read. */
  bodyStatus: unknown;
}

export interface ApprovePlan extends PlanBase {
  kind: "approve";
  approval: ApprovalInput;
  teamNotes: string;
  /** The live setlist's «Mensaje para el equipo» the approval overwrites (an empty proposal note blanks it). */
  liveTeamNotes: string;
  /** The stored `setlist_song` items the approval writes, leaders carried over on a worship night. */
  songs: Record<string, unknown>[];
  hasSongs: boolean;
  setlistId: string;
  setlistWrite: SetlistWrite;
  lock: StoredLock | null;
  bootstrapped: boolean;
  subject: ProposalReviewSubject;
}

export interface TransitionPlan extends PlanBase {
  kind: "transition";
  intent: TransitionIntent;
  lock: StoredLock | null;
  bootstrapped: boolean;
  specialRole: { _id: string; _rev: string; date: string } | null;
  /** Peek only: the role whose `published`/participants the check reports. */
  subject: ProposalReviewSubject | null;
}

export type ProposalReviewPlan = ReplayPlan | ApprovePlan | TransitionPlan;

export type ProposalReviewPlanLoad = { ok: true; plan: ProposalReviewPlan } | Refusal;

function stringField(doc: unknown, field: string): string {
  const value = doc && typeof doc === "object" ? (doc as Record<string, unknown>)[field] : undefined;
  return typeof value === "string" ? value : "";
}

function roleTypeOf(target: CanonicalTarget): RoleTypeName {
  return target.serviceType === "special"
    ? "special_role"
    : target.serviceType === "sunday"
      ? "sunday_role"
      : "saturday_role";
}

/**
 * The writer's prefix: everything `reviewProposal` checks before its transaction,
 * in the same order. `"peek"` skips only the revision assertion (it reports
 * `docRev`) and never runs the lock bootstrap.
 */
export async function planProposalReview(
  id: string,
  request: ProposalReviewRequest,
  mode: ProposalReviewMode,
): Promise<ProposalReviewPlanLoad> {
  // Only the guarded retarget may load a proposal whose stored target drifted
  // from its role — repairing exactly that drift is what it is for.
  const reconciling = request.action === "reconcile_target";
  const loaded = await loadCanonicalProposal(
    id,
    reconciling ? ["date_mismatch", "role_type_mismatch"] : [],
  );
  if (!loaded.ok) {
    return refuse(serviceError(loaded.failure.code, { details: loaded.failure.details }));
  }
  const { doc, validation, role } = loaded.proposal;
  const target = targetFromCanonicalRole(role);
  if (!target) {
    return refuse(
      serviceError("integrity_conflict", { details: { id, roleId: role._id, detail: "role_target" } }),
    );
  }
  // The proposal's own stored target must agree with the authorized canonical
  // role; a disagreement is reconciled explicitly, never silently published.
  if (!reconciling && validation.targetKey !== target.targetKey) {
    return refuse(
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

  const base = {
    id,
    doc,
    target,
    role: role as unknown as Record<string, unknown>,
    roleType: roleTypeOf(target),
    docRev: typeof doc._rev === "string" ? doc._rev : "",
    needsBootstrap: false,
  };
  if (request.action === "approve") {
    return planApproval({ ...base, validation, request, mode });
  }
  return planTransition({ ...base, request, mode });
}

// ── Approval ────────────────────────────────────────────────────────────────

type PlanArgs = PlanBase & {
  request: ProposalReviewRequest;
  mode: ProposalReviewMode;
};

async function planApproval(
  args: PlanArgs & { validation: { contentState: string } },
): Promise<ProposalReviewPlanLoad> {
  const { id, doc, target, request, mode } = args;

  const songRows = storedProposalSongRows(doc.songs);
  if (!songRows) {
    return refuse(
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
      return { ok: true, plan: { ...args, kind: "replay", status: "approved", bodyStatus: "approved" } };
    }
    if (decision === "unverified") {
      return refuse(
        serviceError("legacy_approval_unverified", { details: { id, detail: "no_valid_receipt" } }),
      );
    }
    return refuse(
      serviceError("integrity_conflict", {
        details: { id, detail: "approval_fingerprint_mismatch" },
      }),
    );
  }

  if (!isAllowedSourceStatus("approve", doc.status)) {
    return refuse(
      serviceError("stale_revision", {
        message: STALE_MESSAGE,
        details: { id, detail: "source_status", status: doc.status },
      }),
    );
  }
  if (mode === "write" && doc._rev !== request.rev) {
    return refuse(
      serviceError("stale_revision", {
        message: STALE_MESSAGE,
        details: { id, storedRev: doc._rev, observedRev: request.rev },
      }),
    );
  }
  if (args.validation.contentState !== "ready") {
    return refuse(
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
    return refuse(serviceError(group.failure.code, { details: group.failure.details }));
  }
  if (group.group.existing?._id !== id) {
    return refuse(
      serviceError("ambiguous_target", {
        details: { id, sharedProposalId: group.group.existing?._id ?? null, detail: "not_shared_proposal" },
      }),
    );
  }

  // ── Resolve the live setlist target and the coordination token ────────────
  if (target.serviceType === "special") {
    const targetLoad = await loadSpecialSetlistTarget(target.serviceRef, target.serviceDate);
    if (!targetLoad.ok) {
      return refuse(serviceError(targetLoad.failure.code, { details: targetLoad.failure.details }));
    }
    const specialRole = targetLoad.target.role;
    // Approval rewrites the whole song list from the proposal, which carries no
    // leaders. On a worship night, carry each song's leaders over from the live
    // list by song reference, filtered to the Lead this request loaded — the
    // patch asserts that same revision (spec §4.2).
    const songs = buildSetlistSongDocs(
      isWorshipNight(specialRole)
        ? carryOverSongLeads(songRows, specialRole.songs, leadSeatIds(specialRole.Lead))
        : songRows.map((row) => ({ ...row, leadIds: [] })),
      nextKey,
    );
    return {
      ok: true,
      plan: {
        ...args,
        kind: "approve",
        approval,
        teamNotes,
        liveTeamNotes: stringField(specialRole, "team_notes"),
        songs,
        hasSongs: songRows.length > 0,
        // The special role IS the live setlist target: its revision assertion both
        // publishes the songs and serializes the service.
        setlistId: specialRole._id,
        setlistWrite: { kind: "patch", id: specialRole._id, rev: specialRole._rev },
        lock: null,
        bootstrapped: false,
        subject: {
          published: specialRole.published,
          // A special role carries its songs inline.
          beforeSongs: specialRole.songs ?? [],
          knownRecipients: serviceParticipants(specialRole),
        },
      },
    };
  }

  const setlistType: WeekendSetlistType =
    target.serviceType === "sunday" ? "featuredSongs" : "saturdarSongs";
  const targetLoad = await loadWeekendSetlistTarget(setlistType, target.serviceDate);
  if (!targetLoad.ok) {
    return refuse(serviceError(targetLoad.failure.code, { details: targetLoad.failure.details }));
  }
  const observed = targetLoad.target.server;
  const coordination = await weekendCoordination(target, mode);
  if (!coordination.ok) return coordination;
  if (coordination.role?._id !== target.serviceRef) {
    return refuse(
      serviceError("integrity_conflict", {
        details: { id, detail: "target_owner_mismatch" },
      }),
    );
  }
  const owner = coordination.role as NonNullable<typeof coordination.role>;
  const subject = {
    published: owner.published,
    // `targetLoad.target.record` is nullable — no setlist document yet is `[]`.
    beforeSongs: targetLoad.target.record?.songs ?? [],
    knownRecipients: serviceParticipants(owner),
  };

  const songs = buildSetlistSongDocs(songRows.map((row) => ({ ...row, leadIds: [] })), nextKey);
  let setlistId: string;
  let setlistWrite: SetlistWrite;
  if (observed.state === "single") {
    setlistId = observed.id;
    setlistWrite = { kind: "patch", id: observed.id, rev: observed.rev };
  } else {
    const created = buildWeekendSetlistDocument({
      setlistType,
      week: target.serviceDate,
      songs,
      teamNotes,
    });
    if (!created) {
      return refuse(serviceError("integrity_conflict", { details: { id, detail: "setlist_id" } }));
    }
    setlistId = created._id;
    setlistWrite = { kind: "create", doc: created };
  }
  return {
    ok: true,
    plan: {
      ...args,
      kind: "approve",
      needsBootstrap: coordination.needsBootstrap,
      approval,
      teamNotes,
      liveTeamNotes:
        typeof targetLoad.target.record?.team_notes === "string" ? targetLoad.target.record.team_notes : "",
      songs,
      hasSongs: songRows.length > 0,
      setlistId,
      setlistWrite,
      lock: coordination.lock,
      bootstrapped: coordination.bootstrapped,
      subject,
    },
  };
}

/** The weekend coordination by mode: the writer's loader, or its read-only twin. */
async function weekendCoordination(
  target: CanonicalTarget,
  mode: ProposalReviewMode,
): Promise<
  | {
      ok: true;
      role: WeekendCoordination["role"];
      lock: StoredLock | null;
      bootstrapped: boolean;
      needsBootstrap: boolean;
    }
  | Refusal
> {
  const input = {
    roleType: target.serviceType === "sunday" ? ("sunday_role" as const) : ("saturday_role" as const),
    week: target.serviceDate,
  };
  if (mode === "peek") {
    const peek = await peekWeekendCoordination(input);
    if (!peek.ok) return refuse(serviceError(peek.failure.code, { details: peek.failure.details }));
    return { ok: true, ...peek.coordination };
  }
  const coordination = await loadWeekendCoordination(input);
  if (!coordination.ok) {
    return refuse(serviceError(coordination.failure.code, { details: coordination.failure.details }));
  }
  return { ok: true, ...coordination.coordination, needsBootstrap: false };
}

// ── request_changes / reopen / reconcile_target ─────────────────────────────

async function planTransition(args: PlanArgs): Promise<ProposalReviewPlanLoad> {
  const { id, doc, target, request, mode } = args;
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
    return {
      ok: true,
      plan: { ...args, kind: "replay", status: String(doc.status ?? ""), bodyStatus: doc.status },
    };
  }

  if (!isAllowedSourceStatus(action, doc.status)) {
    return refuse(
      serviceError("stale_revision", {
        message: STALE_MESSAGE,
        details: { id, detail: "source_status", status: doc.status },
      }),
    );
  }
  if (mode === "write" && doc._rev !== request.rev) {
    return refuse(
      serviceError("stale_revision", {
        message: STALE_MESSAGE,
        details: { id, storedRev: doc._rev, observedRev: request.rev },
      }),
    );
  }

  // Coordination: the weekend lock, or the special role's own revision.
  if (target.serviceType === "special") {
    const targetLoad = await loadSpecialSetlistTarget(target.serviceRef, target.serviceDate);
    if (!targetLoad.ok) {
      return refuse(serviceError(targetLoad.failure.code, { details: targetLoad.failure.details }));
    }
    const role = targetLoad.target.role;
    return {
      ok: true,
      plan: {
        ...args,
        kind: "transition",
        intent,
        lock: null,
        bootstrapped: false,
        specialRole: { _id: role._id, _rev: role._rev, date: target.serviceDate },
        subject: {
          published: role.published,
          beforeSongs: role.songs ?? [],
          knownRecipients: serviceParticipants(role),
        },
      },
    };
  }
  const coordination = await weekendCoordination(target, mode);
  if (!coordination.ok) return coordination;
  if (coordination.role?._id !== target.serviceRef) {
    return refuse(
      serviceError("integrity_conflict", { details: { id, detail: "target_owner_mismatch" } }),
    );
  }
  const owner = coordination.role as NonNullable<typeof coordination.role>;
  return {
    ok: true,
    plan: {
      ...args,
      kind: "transition",
      needsBootstrap: coordination.needsBootstrap,
      intent,
      lock: coordination.lock,
      bootstrapped: coordination.bootstrapped,
      specialRole: null,
      subject: { published: owner.published, beforeSongs: null, knownRecipients: serviceParticipants(owner) },
    },
  };
}

// ── The writer ──────────────────────────────────────────────────────────────

/** Who decides: the session's member on `/admin`, the bearer's member on the MCP. */
export interface ProposalReviewActor {
  reviewerId: string | null;
}

/**
 * What a decision already held, for a caller that must report it. Nothing here
 * is re-read after the commit.
 */
export interface ProposalReviewEffects {
  action: ProposalAction;
  /** The proposal's status after the call. */
  status: string;
  /** True for a no-write replay of an already-committed identical decision. */
  idempotent: boolean;
  roleId: string;
  roleType: RoleTypeName;
  serviceDate: string;
  /** Approve only: the live setlist written (the special role itself, or the weekend setlist). */
  setlistId: string | null;
  /** Approve only: the stored `setlist_song` items exactly as written (leaders included). */
  songs: Record<string, unknown>[] | null;
  /** Approve only: the live songs the approval replaced, as loaded before the commit. */
  replacedSongs: unknown;
  /** The service's publication flag as loaded before the commit; null on a replay. */
  published: unknown;
  /** The review push's audience (lead + contributors); empty when no push was started. */
  pushRecipients: string[];
  /** `queueSetlistNotice`'s descriptor; null when it skipped (or for a transition / replay). */
  notice: SetlistNoticeDescriptor | null;
}

export async function reviewProposal(
  id: string,
  raw: unknown,
  actor: ProposalReviewActor,
): Promise<CommitOutcome<ProposalReviewEffects>> {
  const parsed = parseProposalTransitionRequest(raw);
  if (!parsed.ok) {
    return refuse(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const request = parsed.value;

  const loaded = await planProposalReview(id, request, "write");
  if (!loaded.ok) return loaded;
  const plan = loaded.plan;

  const now = nowIso();
  const reviewerId = actor.reviewerId;

  if (plan.kind === "replay") {
    return {
      ok: true,
      status: 200,
      body: { ok: true, status: plan.bodyStatus, idempotent: true },
      effects: {
        action: request.action,
        status: plan.status,
        idempotent: true,
        roleId: plan.target.serviceRef,
        roleType: plan.roleType,
        serviceDate: plan.target.serviceDate,
        setlistId: null,
        songs: null,
        replacedSongs: null,
        published: null,
        pushRecipients: [],
        notice: null,
      },
    };
  }
  if (plan.kind === "approve") return commitApproval(plan, request.rev, now, reviewerId);
  return commitTransition(plan, request, now, reviewerId);
}

async function commitApproval(
  plan: ApprovePlan,
  proposalRev: string,
  now: string,
  reviewerId: string | null,
): Promise<CommitOutcome<ProposalReviewEffects>> {
  const { id, doc, target, approval, setlistId, songs, teamNotes, lock, bootstrapped, subject } = plan;

  const receipt = buildApprovalReceipt({ approval, setlistId, now, approvedBy: reviewerId });
  if (!receipt) {
    return refuse(serviceError("integrity_conflict", { details: { id, detail: "receipt_build" } }));
  }

  // ── ONE transaction: proposal + coordination + live setlist + receipt ─────
  let tx = writeClient.transaction();
  tx = tx.patch(id, (p) =>
    p.ifRevisionId(proposalRev).set({
      status: "approved",
      reviewed_at: now,
      approval_receipt: receipt,
    }),
  );
  const write = plan.setlistWrite;
  tx =
    write.kind === "patch"
      ? tx.patch(write.id, (p) => p.ifRevisionId(write.rev).set({ songs, team_notes: teamNotes }))
      : tx.create(write.doc);
  if (lock) {
    const lockRev = lock._rev;
    tx = tx.patch(lock._id, (p) => p.ifRevisionId(lockRev).set({ updatedAt: now }));
  }

  try {
    await tx.commit();
  } catch (err) {
    const kind = sanityConflictKind(err);
    if (!kind) throw err;
    return refuse(
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
  // An approval writes the LIVE setlist (§2). Same subject key as the manual
  // writer, so one service produces one outbox document however the songs got there.
  const notice = queueSetlistNotice({
    roleId: target.serviceRef,
    roleType: plan.roleType,
    serviceDate: target.serviceDate,
    published: subject.published,
    beforeSongs: subject.beforeSongs,
    hasSongs: plan.hasSongs,
    knownRecipients: subject.knownRecipients,
  });
  // The approved proposal just wrote the real setlist — refresh the cached
  // home/schedule/song pages so it shows without waiting for ISR expiry.
  revalidateProposalApproval();
  return {
    ok: true,
    status: 200,
    body: { ok: true, status: "approved", setlistId },
    effects: {
      action: "approve",
      status: "approved",
      idempotent: false,
      roleId: target.serviceRef,
      roleType: plan.roleType,
      serviceDate: target.serviceDate,
      setlistId,
      songs,
      replacedSongs: subject.beforeSongs,
      published: subject.published,
      pushRecipients: proposalReviewRecipients(doc),
      notice,
    },
  };
}

async function commitTransition(
  plan: TransitionPlan,
  request: { action: ProposalAction; rev: string; adminNotes: string },
  now: string,
  reviewerId: string | null,
): Promise<CommitOutcome<ProposalReviewEffects>> {
  const { id, doc, target, intent, lock, bootstrapped, specialRole } = plan;
  const action = request.action;
  const reconcile = action === "reconcile_target";

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
        // `admin_notes` is NOT set. The transition was the last writer of that
        // mirror and it stops here; `request.adminNotes` still feeds
        // `transitionMessage` below, which is where the change request now lives.
        //
        // Not setting it is also what stops `reopen` with an empty note from
        // BLANKING the archive, which is what writing the request verbatim did.
        // The stored value is left exactly as it is — read the rollback note in
        // the plan before restoring this write.
        reviewed_at: now,
        last_transition: record,
      };

  // The transition's own message in the thread (Child A §4).
  //
  // Three rules, and none of them is the cap:
  //  - `reconcile_target` NEVER appends. It is metadata repair, not a decision.
  //  - `reopen` with an empty note appends nothing and still commits the status
  //    change — an admin legitimately reopens without saying anything.
  //    `buildProposalMessage` returns null on an empty body, so this falls out of
  //    the builder rather than needing its own branch.
  //  - **Exempt from `PROPOSAL_MESSAGES_MAX`.** A full thread must never block a
  //    review decision. "Exempt from the cap" is NOT "always appends": the two
  //    rules above still hold.
  //
  // **Also exempt from `isThreadOpen`**, which both standalone message routes DO
  // enforce. Same reason as the cap: a `request_changes` on a past-dated service
  // must still commit, and a decision must not be blocked by the conversation's
  // lifecycle. The visible consequence is real and accepted — the note lands in a
  // thread both surfaces render as closed, so neither party can reply to it.
  //
  // It inherits `ifRevisionId` from the patch it rides in, UNLIKE the two
  // standalone message routes, which deliberately assert nothing. The asymmetry
  // is intentional: this note is part of a reviewed decision, so it must not
  // land if the decision does not.
  const transitionMessage = reconcile
    ? null
    : buildProposalMessage({
        authorId: reviewerId,
        authorRole: "admin",
        kind: "admin_change_request",
        body: request.adminNotes,
        now,
        key: nextKey(),
      });

  const proposalRev = request.rev;
  let tx = writeClient.transaction().patch(id, (p) => {
    const patched = p.ifRevisionId(proposalRev).set(set);
    // `setIfMissing` is mandatory before an append: Sanity rejects an append to
    // an absent array, and inside a transaction that failure takes the WHOLE
    // transaction down — so without it an admin could not request changes at all
    // on any proposal the migration never touched.
    return transitionMessage
      ? patched.setIfMissing({ messages: [] }).append("messages", [transitionMessage])
      : patched;
  });
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
    return refuse(
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

  const status = reconcile ? String(doc.status ?? "") : "changes_requested";
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      status: reconcile ? doc.status : "changes_requested",
      ...(reconcile ? { targetKey: target.targetKey } : {}),
    },
    effects: {
      action,
      status,
      idempotent: false,
      roleId: target.serviceRef,
      roleType: plan.roleType,
      serviceDate: target.serviceDate,
      setlistId: null,
      songs: null,
      replacedSongs: null,
      published: plan.subject?.published ?? null,
      pushRecipients: push ? proposalReviewRecipients(doc) : [],
      notice: null,
    },
  };
}
