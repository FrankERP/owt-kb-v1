// Post-commit side effects for every protected service writer (Service
// Readiness A2 §7). One place, so the rules cannot drift per route:
//
//  - Recipients derive from COMMITTED server state across all five seat paths
//    (`Lead[]._ref`, `BGVs[]._ref`, `Chorus[]._ref`, `instruments[].person._ref`,
//    `foh_team[].person._ref`) — never a client-supplied list.
//  - Nothing here runs unless a business commit succeeded. A prevalidation or
//    transaction conflict, a no-op idempotent retry, an unpublish and a DRAFT
//    edit are all silent; the caller simply never builds a notice. A REMOVAL is
//    no longer silent — see `queueRoleNotices` below.
//  - IMMEDIATE signals: published create -> a push to every initial assignee.
//    Published/grandfathered edit, swap or copy -> a push to the newly added
//    assignees PER DESTINATION ROLE. `false -> true` -> a push plus the
//    consolidated publish EMAIL, which deliberately stays outside the outbox
//    (spec §7): publishing is a single deliberate click and that email must not
//    be delayed.
//  - DEBOUNCED signals: every committed seat write also queues one
//    `notificationOutbox` notice per member in the union of before- and
//    after-assignees (spec §2). The immediate assignment email is gone, absorbed
//    by that queue — keeping both would produce "te asignaron" now and "tu rol
//    cambió" fifteen minutes later for one edit. The push says SOMETHING
//    changed; the grouped email, once the edits stop, says WHAT.
//    A committed live-setlist write queues one `setlist` notice for the SERVICE
//    (keyed on the owning role, so the manual writer and the approve path share
//    one subject), a `false -> true` publish queues the same notice with an EMPTY
//    snapshot so publishing INTRODUCES the setlist, and a lead-notes edit on an
//    already-reviewable proposal queues one `leadNotes` notice for admins.
//  - LAYER 2 of the flush triggers (spec §3): the same `after()` block that
//    commits an outbox upsert then runs the sweep OPPORTUNISTICALLY, derating
//    BOTH knobs to half. See `commitUpserts` for why it lives there and what it
//    structurally cannot do.
//  - Delivery is BEST-EFFORT, NO RETRY, DUPLICATES POSSIBLE on two enumerated
//    paths (spec §1): a re-pend during a send, and a lease expiry after a killed
//    sweep. Spec §1 explicitly retired the earlier "at-most-once" label — it is
//    simply the wrong name for a mechanism that enumerates two duplicate paths,
//    and it was load-bearing in three separate justifications. What is true:
//    each attempt is logged and swallowed,
//    never rolled back into content, and one failure never skips the rest. A
//    committed request can register MORE THAN ONE deferred `after()` block —
//    a published edit registers two (the push fan-out, then the outbox
//    upsert), a swap registers one push fan-out plus one outbox upsert per
//    affected role. What stays true per notice is idempotency: each outbox
//    upsert's `_id` is deterministic (member + role, role, or proposal), so an
//    HTTP retry that replays a request produces no second outbox document,
//    whatever the number of attempts.
//
// Reads here go through the canonical operational client, so the audience is the
// published perspective and a `drafts.*` overlay can never widen it. The one
// WRITE here is the outbox upsert, on `writeClient`, in its own transaction.

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { writeClient } from "@/sanity/lib/serverClient";
import { revalidateServiceViews } from "./revalidate";
import { WORSHIP_AUDIENCE_GROQ_FILTER } from "@/app/ministries";
import { sendPush } from "./push";
import {
  rolesForMember,
  sendAssignmentEmailsBatch,
  type ServiceBody,
  type ServiceType,
} from "./assignmentEmail";
import {
  addedAssignees,
  assignedMemberRefsQuery,
  setlistRecipientIds,
  type SetlistPref,
} from "./notifyTargets";
import { buildUpsert, outboxId, songRowsFrom } from "./outboxNotice";
import {
  EMAIL_LIMIT,
  SEND_BUDGET_MS,
  SWEEP_DEADLINE_MS,
  sweepOutbox,
  type SweepOptions,
  type SweepReport,
} from "./outboxSweep";
import { reportDestroyedMail } from "./outboxLiveness";
import { SEND_TIMEOUT_MS } from "./email";
import { notifyProposalSubmitted } from "./proposalNotify";
import { canonicalSetlistsForWeeksQuery } from "./serviceReadQueries";
import { normalizeStoredSeats, seatAssignees, type NormalizedSeats } from "./roleWriteRequest";

/** Run one delivery attempt; log and swallow any failure. Never rejects. */
export async function attempt(label: string, fn: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[sideEffects] ${label} failed:`, err);
  }
}

/**
 * Synchronous counterpart to {@link attempt}: run one SYNCHRONOUS build step
 * that happens after a business write already committed, and log-and-swallow
 * any throw exactly like a deferred delivery attempt. Without this, a throw
 * while building a post-commit payload would propagate out of the route
 * handler and turn an already-committed content write into a 500 for the
 * client — the one thing §7's guarantee says must never happen.
 */
export function attemptSync(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[sideEffects] ${label} failed:`, err);
  }
}

/**
 * Start a delivery WITHOUT waiting for it, so a user-facing save is never held
 * open by FCM. The rejection handler keeps a failure logged and swallowed (§7)
 * rather than surfacing as an unhandled rejection.
 *
 * READ THIS BEFORE ADDING A CALLER, now that it is exported. It starts a promise
 * nobody awaits, so on a serverless runtime the delivery can be killed when the
 * response returns.
 *
 * Its in-module call sites are awaited inline by their routes and are NOT inside
 * `after()` — `notifySetlistSaved`, and `notifyProposalReview` when its
 * `awaitDelivery` option is off. That is the deliberate trade in the paragraph
 * above — an editor's save never waits on FCM — and it means the exposure is
 * real on those paths today, not hypothetical.
 *
 * The contrast is `notifyRoleAssignments` and `notifyRolePublished`, this
 * module's two other push fan-outs: both wrap in `after()` and `await sendPush`
 * inside it.
 *
 * So: a new caller should be inside `after()` — and **`after()` must be given
 * something to AWAIT**. `after(() => fireAndForget(p))` is not that: this
 * function returns `void`, the after-queue goes idle at once, `waitUntil`
 * settles, and the promise is left racing the freeze with LESS overlap than if
 * it had been started inline, because nothing else is still running. A caller
 * that wants the invocation held must await the promise itself inside the
 * callback — use `attempt`, which this module exports for exactly that. That
 * mistake shipped once here and a re-verification caught it.
 *
 * (Symbols, not same-file line numbers, on purpose — three successive reviews
 * of this comment caught line references that had rotted, twice because they
 * were computed against the buffer before the edit that moved them.)
 */
export function fireAndForget(label: string, promise: unknown): void {
  void Promise.resolve(promise).catch((err) => {
    console.error(`[sideEffects] ${label} failed:`, err);
  });
}

// ── Role assignment notices ─────────────────────────────────────────────────

export type RoleAssignmentKind = "created" | "updated";

export interface RoleAssignmentNotice {
  /** Member ids from committed server state across all five seat paths. */
  recipients: string[];
  type: ServiceType;
  date: string;
  body: ServiceBody;
  kind: RoleAssignmentKind;
}

const PUSH_TITLE: Record<RoleAssignmentKind, string> = {
  created: "Nuevo servicio asignado",
  updated: "Servicio actualizado",
};

function assignmentPush(kind: RoleAssignmentKind, date: string) {
  return { title: PUSH_TITLE[kind], body: `Te asignaron para el ${date}.`, path: "/me" };
}

function bodyOf(seats: NormalizedSeats): ServiceBody {
  return {
    leads: seats.leads,
    bgvs: seats.bgvs,
    chorus: seats.chorus,
    instruments: seats.instruments,
    foh: seats.foh,
  };
}

/**
 * A published create notifies every initial assignee. A draft create is silent —
 * the service is admin-only until it is published, and publishing is what
 * notifies (see {@link notifyRolePublished}).
 */
export function roleCreateNotice(input: {
  published: boolean;
  seats: NormalizedSeats;
  type: ServiceType;
  date: string;
}): RoleAssignmentNotice | null {
  if (!input.published) return null;
  const recipients = seatAssignees(input.seats);
  if (!recipients.length) return null;
  return {
    recipients,
    type: input.type,
    date: input.date,
    body: bodyOf(input.seats),
    kind: "created",
  };
}

/**
 * The IMMEDIATE PUSH audience only. A published (or grandfathered: `published`
 * absent) edit / swap / copy pushes to the assignees this operation ADDED to
 * that destination role; a draft, a removal and a no-op change push nothing.
 *
 * A removal is no longer silent overall — `queueRoleNotices` queues its email
 * from the UNION of before- and after-assignees. Only the push stays additive,
 * because "Te asignaron" is the wrong words for someone who was just dropped.
 */
export function roleUpdateNotice(input: {
  published: unknown;
  /**
   * The assignees stored BEFORE this transaction, across all five seat paths.
   * Passed in rather than re-derived so each writer keeps its own committed-state
   * source of truth (a validated role's raw refs, or its normalized seats).
   */
  beforeAssignees: string[];
  after: NormalizedSeats;
  type: ServiceType;
  date: string;
}): RoleAssignmentNotice | null {
  // `published !== false` — missing/true is member-visible (grandfathered).
  if (input.published === false) return null;
  const recipients = addedAssignees(input.beforeAssignees, seatAssignees(input.after));
  if (!recipients.length) return null;
  return {
    recipients,
    type: input.type,
    date: input.date,
    body: bodyOf(input.after),
    kind: "updated",
  };
}

/**
 * ONE deferred fan-out for a whole committed batch: a push per destination role,
 * and nothing else. `null`/empty notices are dropped, so a batch with nothing to
 * say registers no attempt at all.
 *
 * The immediate assignment EMAIL this used to send is gone (spec §7): it is
 * fully absorbed by the outbox notice `queueRoleNotices` queues on the same
 * committed write. Keeping it would mail "te asignaron" now and "tu rol cambió"
 * fifteen minutes later for one edit. Only the email leg went — the push leg is
 * untouched, so members still get an immediate in-app signal, and the pairing is
 * deliberate: the push says SOMETHING changed, the grouped email says WHAT.
 */
export function notifyRoleAssignments(notices: (RoleAssignmentNotice | null)[]): void {
  const real = notices.filter(
    (n): n is RoleAssignmentNotice => !!n && n.recipients.length > 0,
  );
  if (!real.length) return;
  after(async () => {
    for (const notice of real) {
      await attempt("assignment push", () =>
        sendPush(notice.recipients, "assignments", assignmentPush(notice.kind, notice.date)),
      );
    }
  });
}

export interface PublishedServiceNotice {
  /** Every CURRENT assignee of the newly published service. */
  recipients: string[];
  type: ServiceType;
  date: string;
  body: ServiceBody;
}

/**
 * A `false -> true` publish batch: a push per newly published service to every
 * one of its current assignees, plus ONE consolidated email per member across
 * the whole batch. An unpublish (or a batch with no real transition) is silent.
 */
export function notifyRolePublished(services: PublishedServiceNotice[]): void {
  if (!services.length) return;
  after(async () => {
    for (const service of services) {
      await attempt("publish push", () =>
        sendPush(service.recipients, "assignments", assignmentPush("created", service.date)),
      );
    }
    await attempt("publish email batch", () =>
      sendAssignmentEmailsBatch(
        services.map((s) => ({ type: s.type, date: s.date, body: s.body })),
      ),
    );
  });
}

// ── Outbox: the debounced role notice (spec §2) ─────────────────────────────

export type RoleTypeName = "sunday_role" | "saturday_role" | "special_role";

export interface QueueRoleNoticesInput {
  roleId: string;
  roleType: RoleTypeName;
  /** `YYYY-MM-DD`, snapshotted so a DELETED role still renders a subject line. */
  serviceDate: string;
  /** The role's stored publication state. `published !== false` is visible. */
  published: unknown;
  /**
   * The seats stored BEFORE this transaction, captured PRE-COMMIT by the writer
   * from the role document it had already loaded (`normalizeStoredSeats`), and
   * threaded in as a value. It is never re-read here: inside `after()` live
   * state is already the POST-write state, which would make `before == after`
   * for every notice — a system that silently sends nothing.
   */
  beforeSeats: NormalizedSeats | null;
  /** The seats this transaction wrote. `null` when the role no longer exists. */
  afterSeats: NormalizedSeats | null;
  /** The role document is gone; it can have no post-state at all. */
  deleted?: boolean;
}

const NO_SEATS: NormalizedSeats = { leads: [], bgvs: [], chorus: [], instruments: [], foh: [] };

/**
 * Queue one debounced `notificationOutbox` notice per affected member, in a
 * post-commit `after()` block, as its OWN transaction on `writeClient` — never
 * the business transaction. A failed outbox write must never abort a committed
 * content write; the accepted cost is that a crash between commit and queue
 * drops that notice.
 *
 * Recipients are the UNION of before- and after-assignees, not the diff.
 * `addedAssignees` compared member ids, which is exactly why being dropped from
 * a service, or moved from BGV to Líder inside one, said nothing at all today.
 *
 * Each member's snapshot holds their OWN seat labels (`rolesForMember`), which
 * is what lets a member who was never introduced to a service stay silent when
 * it is deleted: their `beforeRoles` is empty, so the classifier has no
 * transition to describe.
 *
 * A draft service queues nothing: it is admin-only until it is published, and
 * publishing is what introduces it.
 */
export function queueRoleNotices(input: QueueRoleNoticesInput): void {
  // The caller already committed the business write; everything below runs
  // AFTER that commit. `attemptSync` guards this whole synchronous build the
  // same way `attempt` guards the deferred write below, so a throw here is
  // logged and swallowed instead of turning a committed write into a 500.
  attemptSync("queueRoleNotices build", () => {
    // `published !== false` — missing/true is member-visible (grandfathered).
    if (input.published === false) return;
    // Same guard as `setlistUpsert`, and for the same reason: `isPast` at flush
    // is a lexicographic YYYY-MM-DD comparison with no defined reading for `""`,
    // so a dateless notice would be minted here and then dropped silently at
    // flush — losing a "Ya no participas" for a deleted role. Unreachable today
    // (every call site supplies a validated date); stated here so the reasoning
    // lives in ONE place rather than only on the setlist path.
    if (!input.serviceDate) return;

    const before = input.beforeSeats ?? NO_SEATS;
    // A deleted role has no post-state, whatever the caller passed.
    const afterState = (input.deleted ? null : input.afterSeats) ?? NO_SEATS;

    const members = [...new Set([...seatAssignees(before), ...seatAssignees(afterState)])];
    if (!members.length) return;

    // Every value the deferred block writes is computed HERE, synchronously, from
    // arguments the writer captured pre-commit. The block itself reads nothing.
    const now = new Date();
    const upserts = members.map((memberId) => ({
      id: outboxId("role", `${memberId}__${input.roleId}`),
      ...buildUpsert(
        {
          kind: "role",
          subjectKey: `${memberId}__${input.roleId}`,
          memberId,
          roleId: input.roleId,
          proposalId: null,
          serviceDate: input.serviceDate,
          roleType: input.roleType,
          before: { beforeRoles: rolesForMember(memberId, before) },
          // One member per `role` notice, so they are the whole known audience.
          knownRecipients: [memberId],
        },
        now,
      ),
    }));

    // ONE transaction for this role's notices — see `commitUpserts`.
    after(() => commitUpserts("outbox role upsert", upserts));
  });
}

// ── Outbox: the debounced setlist notice (spec §2/§4) ───────────────────────

/** The participants of one service, across all five member-referencing seats. */
export function serviceParticipants(role: unknown): string[] {
  return seatAssignees(normalizeStoredSeats(role));
}

export interface QueueSetlistNoticeInput {
  /**
   * The SERVICE ROLE that owns this setlist — the `setlist` subject key (§4).
   * The manual weekend writer holds only `week` + `setlistType` and must resolve
   * it through `loadWeekendCoordination(...).coordination.role`; the approve path
   * holds the same id as `target.serviceRef`, which it has already asserted is
   * that same coordination role. Both therefore key one service one way.
   */
  roleId: string;
  roleType: RoleTypeName;
  /** `YYYY-MM-DD`. A notice whose live date has moved is dropped at flush (§4). */
  serviceDate: string;
  /** The role's stored publication state. `published !== false` is visible. */
  published: unknown;
  /**
   * The stored `songs` array as it was BEFORE this transaction, captured
   * PRE-COMMIT by the writer from the target it had already loaded, and threaded
   * in as a value. Never re-read here: inside `after()` live state is already the
   * POST-write state, which would make `before == after` for every notice.
   * `loadWeekendSetlistTarget(...).target.record` is nullable, so a missing
   * record is `[]` — an absent setlist target, not a malformed one.
   */
  beforeSongs: unknown;
  /**
   * Does the service hold ANY songs after this write? `[] -> []` says nothing,
   * so it is not worth an outbox document — the same reading `classifySetlist`
   * applies when it refuses to build a line for an empty live setlist.
   */
  hasSongs: boolean;
  /**
   * The participants known at queue time. A recipient absent from this set is
   * new to the subject and is INTRODUCED at flush ("Setlist listo") rather than
   * sent a diff against a list they never saw.
   */
  knownRecipients: string[];
}

/** Build one `setlist` upsert, or `null` when this write says nothing. */
function setlistUpsert(input: QueueSetlistNoticeInput, now: Date) {
  // `published !== false` — missing/true is member-visible (grandfathered).
  if (input.published === false) return null;
  if (!input.roleId) return null;
  // A notice with no usable date could never render a correct subject line —
  // `isPast` at flush is a lexicographic YYYY-MM-DD comparison with no defined
  // reading for `""`. Declining to mint the notice here is the right outcome,
  // not deferring to that comparison's incidental behavior.
  if (!input.serviceDate) return null;
  if (!input.hasSongs) return null;
  return {
    id: outboxId("setlist", input.roleId),
    ...buildUpsert(
      {
        kind: "setlist",
        subjectKey: input.roleId,
        memberId: null,
        roleId: input.roleId,
        proposalId: null,
        serviceDate: input.serviceDate,
        roleType: input.roleType,
        before: { beforeSongs: songRowsFrom(input.beforeSongs) },
        knownRecipients: input.knownRecipients,
      },
      now,
    ),
  };
}

type BuiltUpsert = NonNullable<ReturnType<typeof setlistUpsert>>;

/**
 * LAYER 2 of the three flush triggers (§3): the opportunistic sweep, DERATED.
 *
 * Both knobs are halved, not one. The knobs satisfy an inequality —
 * `ms_per_send × emailLimit < sendBudgetMs` (§1, "Bounding the sweep") — and
 * halving only the limit would let a sweep hosted inside an admin's save spend a
 * FULL 40 s of send budget after that write route had already consumed part of
 * its own `maxDuration`.
 *
 * SO THE BUDGET IS DERATED ABOVE THE RESERVE, NOT AS A WHOLE. The send loop
 * admits a send only while `elapsed + SEND_TIMEOUT_MS <= sendBudgetMs` — a
 * RESERVE, because a send's worst case is `SEND_TIMEOUT_MS` and a wave that
 * starts without room for it overruns into the platform's kill. That reserve is
 * a property of ONE send and cannot shrink with the budget.
 *
 * Halving the budget as a whole therefore did not derate layer 2, it disabled
 * it: at `SEND_BUDGET_MS / 2` = 20 s the check read `elapsed + 20 000 > 20 000`,
 * false only when `elapsed` is 0, so layer 2 sent **exactly one email per
 * sweep at any latency** and its `emailLimit` never bound. The knobs said 20
 * recipients and the clock allowed one.
 *
 * Only the part ABOVE the reserve is actually spendable, so that is what gets
 * halved:
 *
 *     sendBudgetMs = SEND_TIMEOUT_MS + (SEND_BUDGET_MS - SEND_TIMEOUT_MS) / 2
 *
 * On the shipped defaults: 20 000 + 10 000 = 30 000, giving layer 2 half of
 * layer 1's spendable 20 s. Sends admitted are `floor(spendable / d) + 1` — nine
 * at the ~1.2 s measured on Gmail, and still **one** at the 14.4 s of the retired
 * server, which is the conservative behaviour the original halving intended and
 * accidentally made unconditional.
 *
 * AND THE WHOLE-SWEEP CLOCK IS DERATED THE SAME WAY. Precisely: the 45 s
 * ceiling capped stage 7 either way, so the GLOBAL worst case did not move — what
 * the budget fix raised is what layer 2 spends at a normal, short read phase,
 * from 20 s to 30 s. Derating this clock is what lowers the ceiling itself, from
 * 45 s to 32.5 s.
 * `SWEEP_DEADLINE_MS` runs from the top of the SWEEP, not the top of the
 * invocation, so it never accounted for the write route's own elapsed time — the
 * budget derate was the only thing that did. Halving its spendable part too
 * (32.5 s on the defaults) restores a real bound on what layer 2 can add to a
 * route that has already been running.
 *
 * That clock is what keeps stage 8 reachable, and stage 8 not running is the
 * 2026-08-06/07 wedge: claims left at `status: "sending"`, the lease re-offering
 * the same batch, nothing delivered.
 *
 * The consequence named in §1 still holds: at a limit of 20 a large Sunday
 * setlist is "oversized" for layer 2 and taken alone.
 *
 * Derived from the sweep's own exported defaults rather than restated as
 * numbers, so retuning `NOTIFY_FLUSH_EMAIL_LIMIT` / `NOTIFY_SEND_BUDGET_MS`
 * cannot leave layer 2 behind on stale constants.
 */
const LAYER_2_DERATE = 2;

/**
 * Halve a sweep clock's SPENDABLE part — everything above the per-send reserve —
 * rather than the clock itself.
 *
 * Exported for its own unit test, because the interesting configurations are the
 * ones no shipped config reaches: below the reserve there is nothing to halve,
 * and `SEND_TIMEOUT_MS + 0` would hand layer 2 MORE than layer 1 and invert the
 * point of derating. `Math.min` against the full value makes "layer 2 never
 * outspends layer 1" hold unconditionally instead of only at the defaults.
 */
export function derateClock(full: number, derate = LAYER_2_DERATE): number {
  return Math.min(full, SEND_TIMEOUT_MS + Math.max(0, full - SEND_TIMEOUT_MS) / derate);
}

export function opportunisticSweepOptions(): Required<
  Pick<SweepOptions, "emailLimit" | "sendBudgetMs" | "sweepDeadlineMs">
> {
  return {
    emailLimit: Math.max(1, EMAIL_LIMIT / LAYER_2_DERATE),
    sendBudgetMs: derateClock(SEND_BUDGET_MS),
    sweepDeadlineMs: derateClock(SWEEP_DEADLINE_MS),
  };
}

/**
 * ONE transaction on `writeClient` for a whole batch of upserts — never the
 * business transaction (§2). No op asserts a revision, so there is no per-op
 * conflict to isolate; a failure here is transport or auth, which would fail
 * every op alike, and `attempt` keeps it logged and swallowed.
 *
 * This is also where LAYER 2 lives, and it lives here for one reason: it is the
 * single funnel every queued notice already passes through, from all four
 * writers (role, setlist, publish-setlist, lead notes), inside an `after()`
 * block that has already left the user's request. Adding the call at each queue
 * function — let alone each route — would be the same line copy-pasted four or
 * fourteen times, with four or fourteen chances to drift.
 *
 * It runs AFTER the upsert, and unconditionally on its outcome: a failed upsert
 * is exactly the moment an older subject's notice most wants flushing, and the
 * sweep gates itself (`isDeliveryBlocked`) rather than trusting its callers.
 * What layer 2 cannot do is flush the subject the admin is editing right now —
 * an in-flight burst keeps sliding `notifyAfter` forward — which is why §3 calls
 * layer 1 load-bearing rather than one of three redundant paths.
 *
 * Nor does layer 2 fire on every protected write. It hangs off the outbox
 * upsert, so a write that queues nothing never reaches it: a draft edit, a
 * no-op save — and also PROPOSAL SUBMIT and PROPOSAL REVIEW, which §3's text
 * names as protected writes but which send immediately via
 * `notifyProposalSubmitted`/`notifyProposalReview` and queue no outbox document
 * at all. Layer 1 sweeps afterwards — nominally the declared tick, measured at a
 * 1.0 h median and occasionally many hours (docs/NOTIFICATIONS.md), so this is a delay rather
 * than the near-immediate follow-up it was written as; noted
 * so the next reader does not read this as complete coverage.
 */
async function commitUpserts(label: string, upserts: BuiltUpsert[]): Promise<void> {
  await attempt(label, () => {
    let tx = writeClient.transaction();
    for (const upsert of upserts) {
      tx = tx
        .createIfNotExists(upsert.createIfNotExists as { _id: string; _type: string })
        .patch(upsert.id, (p) => p.set(upsert.patchSet));
    }
    return tx.commit();
  });
  // The report is KEPT, not discarded. Layer 2 used to be the only flush path
  // with no reporter at all: layer 1's workflow reads its report and goes red,
  // layer 3 mails a super-admin (`reportDestroyedMail`), and this one threw the
  // same numbers away — so a sweep here that destroyed every send looked exactly
  // like one that delivered everything, and consumption is unconditional on send
  // outcome (ADR-0026), so nothing else would ever have said otherwise.
  //
  // Issue #20 assumed this needed a DIFFERENT alarm from layer 3's, because
  // layer 2 fires on every mutation and a derated sweep hitting its send budget
  // mid-session is ordinary. That premise was wrong, and checking it is what made
  // this small: budget exhaustion moves `unserved` ONLY, and those recipients are
  // RE-PENDED rather than consumed (`outboxSweep.ts` `partitionClaimed`). It
  // touches neither `failed` nor `lost`, so the alarm's gate cannot fire on it.
  // Ordinary editing is silent, and the same thresholds work here unchanged.
  let sweep: SweepReport | undefined;
  await attempt("opportunistic sweep", async () => {
    sweep = await sweepOutbox(opportunisticSweepOptions());
  });
  // Guarded even though `reportDestroyedMail` never throws by contract. Three of
  // the four callers are bare `after(() => commitUpserts(...))` with no outer
  // guard, so without this the module's "a post-commit throw never escapes"
  // property would depend on a contract maintained in another file. `undefined`
  // (the sweep itself threw) reports nothing destroyed rather than guessing.
  await attempt("destroyed-mail alarm", () =>
    reportDestroyedMail(sweep, "Un barrido tras una edición"),
  );
}

/**
 * Queue the debounced `setlist` notice for ONE service, in a post-commit
 * `after()` block. Called by the two writers that change a live setlist: the
 * manual editor save and the proposal approval — the latter writes the live
 * setlist today and said nothing about it at all.
 */
export function queueSetlistNotice(input: QueueSetlistNoticeInput): void {
  // The caller already committed the business write. `attemptSync` guards this
  // whole synchronous build so a throw here is logged and swallowed instead of
  // turning a committed content write into a 500 for the client.
  attemptSync("queueSetlistNotice build", () => {
    const upsert = setlistUpsert(input, new Date());
    if (!upsert) return;
    after(() => commitUpserts("outbox setlist upsert", [upsert]));
  });
}

export interface PublishedSetlistSubject {
  roleId: string;
  roleType: RoleTypeName;
  serviceDate: string;
  /** The canonical role document — a special service carries its songs inline. */
  role: unknown;
  knownRecipients: string[];
}

const WEEKEND_SETLIST_TYPE: Record<string, string> = {
  sunday_role: "featuredSongs",
  saturday_role: "saturdarSongs",
};

/**
 * Publishing must ANNOUNCE the setlist (§2). The dominant workflow is *create as
 * draft → build the setlist → publish*, and nothing queues while the service is a
 * draft — so without this a service published with a setlist already on it would
 * send no setlist email at all, and the member's first one would be "El setlist
 * cambió" on the first post-publish edit.
 *
 * Every `false -> true` transition therefore queues one `setlist` notice with an
 * EMPTY before-snapshot, which classifies as "Setlist listo": the member's proper
 * introduction. A service published with no songs is `[] -> []` and queues
 * nothing.
 *
 * Both publish surfaces (`publish` and `publish-ready`) call exactly this, so the
 * two cannot drift. Publishing writes no songs, so resolving song presence INSIDE
 * the deferred block is exact — and it keeps the read off the admin's request.
 * The `before` snapshot is the constant `[]`, so nothing here is subject to the
 * pre-commit capture rule.
 */
export function queuePublishedSetlistNotices(subjects: PublishedSetlistSubject[]): void {
  // The caller already committed the business write. `attemptSync` guards this
  // whole synchronous body — including registering the deferred block below —
  // the same way its siblings (`queueRoleNotices`, `queueSetlistNotice`,
  // `queueLeadNotesNotice`) guard theirs, so a throw here is logged and
  // swallowed instead of turning a committed content write into a 500 for the
  // client.
  attemptSync("queuePublishedSetlistNotices build", () => {
    if (!subjects.length) return;
    after(async () => {
      await attempt("outbox publish setlist upsert", async () => {
        const weeks = [
          ...new Set(
            subjects
              .filter((s) => s.roleType !== "special_role")
              .map((s) => s.serviceDate)
              .filter(Boolean),
          ),
        ];
        const bound = weeks.length ? canonicalSetlistsForWeeksQuery(weeks) : null;
        const rows = bound
          ? ((await operationalClient.fetch<Record<string, unknown>[]>(bound.query, bound.params)) ?? [])
          : [];

        const hasSongs = (subject: PublishedSetlistSubject): boolean => {
          if (subject.roleType === "special_role") {
            const songs = (subject.role as { songs?: unknown } | null)?.songs;
            return Array.isArray(songs) && songs.length > 0;
          }
          const type = WEEKEND_SETLIST_TYPE[subject.roleType];
          const doc = rows.find((r) => r?._type === type && r?.week === subject.serviceDate);
          return Array.isArray(doc?.songs) && (doc.songs as unknown[]).length > 0;
        };

        const now = new Date();
        const upserts = subjects
          .map((subject) =>
            setlistUpsert(
              {
                roleId: subject.roleId,
                roleType: subject.roleType,
                serviceDate: subject.serviceDate,
                // Publishing IS the `false -> true` transition; the role is visible.
                published: true,
                beforeSongs: [],
                hasSongs: hasSongs(subject),
                knownRecipients: subject.knownRecipients,
              },
              now,
            ),
          )
          .filter((u): u is BuiltUpsert => !!u);
        if (!upserts.length) return;
        await commitUpserts("outbox publish setlist upsert", upserts);
      });
    });
  });
}

// ── Outbox: the debounced lead-notes notice (spec §2) ───────────────────────

/**
 * The statuses that mean a proposal is ALREADY in front of admins. The predicate
 * is deliberately about the state BEFORE this write, not after: a `draft ->
 * pending` submit already sends admins the immediate "Nueva propuesta", and
 * queueing on the same write would mail them twice about one submission. Lead
 * notes on a `draft` proposal are silent for the same reason inverted — there is
 * nothing in front of admins to act on yet.
 */
const REVIEWABLE_BEFORE_WRITE = new Set(["pending", "changes_requested"]);

export interface QueueLeadNotesNoticeInput {
  proposalId: string;
  /** `YYYY-MM-DD`, snapshotted so a deleted proposal still renders a subject. */
  serviceDate: string;
  /** The proposal's stored status BEFORE this write; `null` when it is new. */
  previousStatus: unknown;
  /**
   * The stored `lead_notes` BEFORE this write, captured PRE-COMMIT.
   *
   * KEPT even though the flush no longer classifies against it.
   *
   * WHO READS IT: production's OLD sweep, which compares this snapshot against
   * the live `lead_notes` during the preview→main window and after a revert.
   * Nothing in THIS tree writes that field any more; the version running in
   * production during the window still does. That is the whole subtlety, and it
   * is why no universal about the two values belongs in this comment — five
   * successive rewrites of this paragraph asserted one, and each was wrong in a
   * different direction, because a claim true of one version is being made about
   * a system running two.
   *
   * WHAT YOU MAY RELY ON: a message posted through `preview` in that window can
   * reach nobody, and when it does, nothing records it — the notice yields no
   * pairs, `partitionClaimed` consumes it, and `countLost` reports 0.
   *
   * SO THE WINDOW IS NOT CLOSED BY THIS MECHANISM. It is closed by release
   * procedure step 3 in
   * `docs/superpowers/plans/2026-08-25-proposal-thread-b-notifications.md` — do
   * not post a thread message through `preview` — which holds even when the
   * outbox pre-check has just returned zero, because the notice at risk is one
   * the window creates. Do not read this field as a mechanical guarantee and
   * relax that step. §The cutover seam owns the analysis, including the revert.
   *
   * Nothing may drop it as dead weight. Five test files touch it and three
   * ASSERT it — the schema field set, and the notice's `before` on each of the
   * two call sites — precisely because the flush no longer gives it a reason to
   * exist.
   */
  beforeNotes: unknown;
  /**
   * The number of `kind == "lead_note"` messages the proposal held BEFORE this
   * write, captured PRE-COMMIT — the index the flush slices the thread from.
   *
   * Counted with `isLeadNote`, the same predicate `LEAD_NOTE_MESSAGES` filters
   * on at flush. Counting the WHOLE array instead is the failure this shape is
   * most exposed to and it is total: with `T` total messages and `L` lead notes,
   * `leadMessages.slice(T)` over a post-commit array of length `L + 1` is empty
   * whenever `T > L` — which is every proposal that has been through one review
   * cycle — so admins stop receiving the debounced email entirely, with a `null`
   * classification, the notice consumed, and `report.lost` at 0.
   */
  beforeMessageCount: number;
}

const asNotes = (v: unknown): string => (typeof v === "string" ? v : "");

/** Queue the debounced `leadNotes` notice, in a post-commit `after()` block. */
export function queueLeadNotesNotice(input: QueueLeadNotesNoticeInput): void {
  attemptSync("queueLeadNotesNotice build", () => {
    if (!input.proposalId) return;
    if (!REVIEWABLE_BEFORE_WRITE.has(String(input.previousStatus ?? ""))) return;
    const before = asNotes(input.beforeNotes);
    // NO trimmed-equal early return any more. It compared `beforeNotes` against
    // `afterNotes`, and post-Child-B there is no "after" string to compare
    // against — the flush diffs a count against the thread. The guard has not
    // moved somewhere else in here: it is now the CALLERS' alone, and both must
    // decline to queue when they appended nothing. A no-append queue is bounded
    // (it classifies to `null` and is consumed) but it clears `servedRecipients`
    // and slides a live debounce for a message that does not exist.

    const upsert = {
      id: outboxId("leadNotes", input.proposalId),
      ...buildUpsert(
        {
          kind: "leadNotes",
          subjectKey: input.proposalId,
          memberId: null,
          roleId: null,
          proposalId: input.proposalId,
          serviceDate: input.serviceDate,
          roleType: null,
          before: { beforeNotes: before, beforeMessageCount: input.beforeMessageCount },
          // The admin audience is resolved at flush from the live team roster;
          // there is no queue-time set to introduce anybody against, and
          // `leadNotes` renders no diff for `knownRecipients` to qualify.
          knownRecipients: [],
        },
        new Date(),
      ),
    };
    after(() => commitUpserts("outbox leadNotes upsert", [upsert]));
  });
}

// ── Manual setlist save ─────────────────────────────────────────────────────

/**
 * The existing setlist audience: every member whose preference is `all`, plus
 * `assigned` members who actually serve that week — resolved from committed
 * canonical state across all five seat paths, never a client list.
 */
export async function notifySetlistSaved(week: string): Promise<void> {
  await attempt("setlist push", async () => {
    // MINISTRY-SCOPED. This is the only worship audience in the codebase that is
    // not already narrowed to specific ids or to an admin role, so it is the only
    // one a Kids-only member could fall into — and they would, because
    // `setlistRecipientIds` reads an unset preference as "all". A Kids volunteer
    // has no reason to be pushed "Ya están las canciones de este servicio".
    //
    // The filter deliberately has no `$all` arm: `WORSHIP_MEMBER_GROQ_FILTER`'s
    // super-admin bypass is for SEEING people in an admin list, and being able to
    // see someone is not a reason to notify them.
    const members = await operationalClient.fetch<{ _id: string; setlist?: SetlistPref }[]>(
      `*[_type == "teamMembers" && ${WORSHIP_AUDIENCE_GROQ_FILTER}]{ _id, "setlist": notifPrefs.setlist }`,
    );
    // `published != false` matches the sibling audience in `api/cron/service-reminders`.
    // Without it, a member whose preference is `assigned` and who serves only on a
    // DRAFT role that week was pushed "Ya están las canciones de este servicio" for a
    // service they cannot open — learning they are rostered before the admin published
    // it. Members whose preference is `all` are unaffected; the publish flow still
    // notifies the assigned ones when the service actually goes live.
    const roleFilter =
      `_type in ["sunday_role","saturday_role","special_role"] && (week == $week || date == $week) && published != false`;
    const assigned = await operationalClient.fetch<string[]>(assignedMemberRefsQuery(roleFilter), {
      week,
    });
    // Fire-and-forget, as before: an editor's save never waits on FCM.
    fireAndForget(
      "setlist push",
      sendPush(setlistRecipientIds(members ?? [], assigned ?? []), "setlist", {
        title: "Setlist de la semana",
        body: "Ya están las canciones de este servicio.",
        path: "/",
      }),
    );
  });
}

// ── Proposals ───────────────────────────────────────────────────────────────

/**
 * A proposal committed as `pending`: the existing admin/co-lead push plus the
 * allowlist- and preference-aware admin email.
 */
export async function notifyProposalPending(opts: {
  leadId: string;
  roleId: string;
  proposalId: string;
  serviceType: "sunday" | "saturday" | "special";
  serviceDate: string;
}): Promise<void> {
  await attempt("proposal pending notify", () => notifyProposalSubmitted(opts));
}

/**
 * Everyone who should hear a review outcome on a shared proposal: its creator plus
 * every contributor, deduped. Derived from the canonical proposal the caller
 * already loaded — never a client list, never a second uncontrolled read.
 */
export function proposalReviewRecipients(doc: Record<string, unknown>): string[] {
  const lead = typeof doc.lead === "string" ? doc.lead : null;
  const contributors = Array.isArray(doc.contributors) ? doc.contributors : [];
  const people = contributors.map((row) => {
    if (!row || typeof row !== "object") return null;
    const person = (row as { person?: unknown }).person;
    if (typeof person === "string") return person;
    return (person as { _ref?: string } | null)?._ref ?? null;
  });
  return [...new Set([lead, ...people].filter((id): id is string => !!id))];
}

/**
 * `request_changes` / `reopen` / `approve` review push to the shared-proposal
 * team — and, with `excludeIds`, the admin's standalone thread message.
 *
 * The audience is the LEAD plus contributors. Read who RECEIVES, not the
 * arrow's direction: this is the right helper whenever the recipient is the
 * lead, and the wrong one whenever the recipient is admins, who have their own
 * query.
 *
 * `excludeIds` is an optional THIRD parameter and changes neither existing call
 * site, both of which pass two arguments. It exists because the helper resolves
 * its own recipients internally and exposes no hook, so "filter in the route"
 * would mean re-implementing `proposalReviewRecipients` + `sendPush` — a second
 * copy of the audience rule.
 *
 * **The filter runs BEFORE the empty-audience guard, and that ordering is the
 * whole point.** A proposal whose only review recipient is the posting admin
 * would otherwise pass the guard on a non-empty list and push them about their
 * own message. Filtering after the guard is a no-op precisely in the one case
 * the parameter exists for.
 */
export async function notifyProposalReview(
  doc: Record<string, unknown>,
  push: { title: string; body: string },
  excludeIds?: readonly string[],
  opts?: { awaitDelivery?: boolean },
): Promise<void> {
  await attempt("proposal review push", async () => {
    const excluded = new Set(excludeIds ?? []);
    const recipients = proposalReviewRecipients(doc).filter((id) => !excluded.has(id));
    if (!recipients.length) return;
    const delivery = sendPush(recipients, "proposals", { ...push, path: "/me" });
    // `awaitDelivery` exists because awaiting THIS function is not enough when
    // the inside is fire-and-forget: a caller running inside `after()` would
    // resolve immediately and let the runtime freeze the instance with FCM still
    // in flight. Off by default, so the transition call sites keep today's trade
    // — a review decision never waits on FCM — and change not at all.
    if (opts?.awaitDelivery) {
      await delivery;
      return;
    }
    fireAndForget("proposal review push", delivery);
  });
}

// ── Cache revalidation, once per affected batch ─────────────────────────────

/** Role create / edit / delete / swap / copy: service views plus the member view. */
export function revalidateRoleMutation(): void {
  revalidateServiceViews();
  revalidatePath("/me");
}

/**
 * Role publish / unpublish: the member-facing views, so an unpublish disappears
 * promptly. Song play-history pages are untouched — publication state does not
 * change any setlist.
 */
export function revalidateRolePublication(): void {
  revalidatePath("/");
  revalidatePath("/schedule");
  revalidatePath("/me");
}

/** Manual setlist save. */
export function revalidateSetlistSave(): void {
  revalidateServiceViews();
}

/** Proposal approval — it just wrote the live setlist. */
export function revalidateProposalApproval(): void {
  revalidateServiceViews();
}
