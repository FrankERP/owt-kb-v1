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
import { EMAIL_LIMIT, SEND_BUDGET_MS, sweepOutbox } from "./outboxSweep";
import { notifyProposalSubmitted } from "./proposalNotify";
import { canonicalSetlistsForWeeksQuery } from "./serviceReadQueries";
import { normalizeStoredSeats, seatAssignees, type NormalizedSeats } from "./roleWriteRequest";

/** Run one delivery attempt; log and swallow any failure. Never rejects. */
async function attempt(label: string, fn: () => unknown | Promise<unknown>): Promise<void> {
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
function attemptSync(label: string, fn: () => void): void {
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
 * its own `maxDuration`. Halving both keeps the inequality holding identically
 * here. The consequence is named in §1 and accepted: at a limit of 20 a large
 * Sunday setlist is "oversized" for layer 2 and taken alone, which is fine
 * because layer 2 is a backstop and layer 1 runs at the full limit.
 *
 * Derived from the sweep's own exported defaults rather than restated as
 * numbers, so retuning `NOTIFY_FLUSH_EMAIL_LIMIT` / `NOTIFY_SEND_BUDGET_MS`
 * cannot leave layer 2 behind on stale constants.
 */
const LAYER_2_DERATE = 2;

function opportunisticSweepOptions(): { emailLimit: number; sendBudgetMs: number } {
  return {
    emailLimit: Math.max(1, EMAIL_LIMIT / LAYER_2_DERATE),
    sendBudgetMs: Math.max(1, SEND_BUDGET_MS / LAYER_2_DERATE),
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
 * at all. Immaterial in practice, since layer 1 sweeps five minutes later; noted
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
  await attempt("opportunistic sweep", () => sweepOutbox(opportunisticSweepOptions()));
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
  /** The stored `lead_notes` BEFORE this write, captured PRE-COMMIT. */
  beforeNotes: unknown;
  /** The notes this transaction committed. */
  afterNotes: unknown;
}

const asNotes = (v: unknown): string => (typeof v === "string" ? v : "");

/** Queue the debounced `leadNotes` notice, in a post-commit `after()` block. */
export function queueLeadNotesNotice(input: QueueLeadNotesNoticeInput): void {
  attemptSync("queueLeadNotesNotice build", () => {
    if (!input.proposalId) return;
    if (!REVIEWABLE_BEFORE_WRITE.has(String(input.previousStatus ?? ""))) return;
    const before = asNotes(input.beforeNotes);
    // The same trimmed comparison `classifyLeadNotes` makes at flush, so a save
    // that did not touch the notes never mints a document that says nothing.
    if (before.trim() === asNotes(input.afterNotes).trim()) return;

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
          before: { beforeNotes: before },
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

/** `request_changes` / `reopen` / `approve` review push to the shared-proposal team. */
export async function notifyProposalReview(
  doc: Record<string, unknown>,
  push: { title: string; body: string },
): Promise<void> {
  await attempt("proposal review push", () => {
    const recipients = proposalReviewRecipients(doc);
    if (!recipients.length) return;
    // Fire-and-forget, as before: a review decision never waits on FCM.
    fireAndForget("proposal review push", sendPush(recipients, "proposals", { ...push, path: "/me" }));
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
