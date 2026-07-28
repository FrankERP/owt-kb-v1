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
//  - Delivery is best-effort AT-MOST-ONCE: each attempt is logged and swallowed,
//    never rolled back into content, and one failure never skips the rest. A
//    committed request can register MORE THAN ONE deferred `after()` block —
//    a published edit registers two (the push fan-out, then the outbox
//    upsert), a swap registers one push fan-out plus one outbox upsert per
//    affected role. What stays true per notice is idempotency: each outbox
//    upsert's `_id` is deterministic (member + role), so an HTTP retry that
//    replays a request produces no second outbox document, whatever the
//    number of attempts.
//
// Reads here go through the canonical operational client, so the audience is the
// published perspective and a `drafts.*` overlay can never widen it. The one
// WRITE here is the outbox upsert, on `writeClient`, in its own transaction.

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { writeClient } from "@/sanity/lib/serverClient";
import { revalidateServiceViews } from "./revalidate";
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
import { buildUpsert, outboxId } from "./outboxNotice";
import { notifyProposalSubmitted } from "./proposalNotify";
import { seatAssignees, type NormalizedSeats } from "./roleWriteRequest";

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
function fireAndForget(label: string, promise: unknown): void {
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

    after(async () => {
      // ONE transaction for this role's notices. No op asserts a revision, so
      // there is no per-op conflict to isolate — a failure here is transport or
      // auth, which would fail every op alike. `attempt` keeps it swallowed.
      await attempt("outbox role upsert", () => {
        let tx = writeClient.transaction();
        for (const upsert of upserts) {
          tx = tx
            .createIfNotExists(upsert.createIfNotExists as { _id: string; _type: string })
            .patch(upsert.id, (p) => p.set(upsert.patchSet));
        }
        return tx.commit();
      });
    });
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
    const members = await operationalClient.fetch<{ _id: string; setlist?: SetlistPref }[]>(
      `*[_type == "teamMembers"]{ _id, "setlist": notifPrefs.setlist }`,
    );
    const roleFilter =
      `_type in ["sunday_role","saturday_role","special_role"] && (week == $week || date == $week)`;
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
