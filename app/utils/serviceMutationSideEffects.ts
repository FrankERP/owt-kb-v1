// Post-commit side effects for every protected service writer (Service
// Readiness A2 §7). One place, so the rules cannot drift per route:
//
//  - Recipients derive from COMMITTED server state across all five seat paths
//    (`Lead[]._ref`, `BGVs[]._ref`, `Chorus[]._ref`, `instruments[].person._ref`,
//    `foh_team[].person._ref`) — never a client-supplied list.
//  - Nothing here runs unless a business commit succeeded. A prevalidation or
//    transaction conflict, a no-op idempotent retry, an unpublish, a removal and
//    a draft edit are all silent; the caller simply never builds a notice.
//  - Published create -> every initial assignee. Published/grandfathered edit,
//    swap or copy -> newly added assignees PER DESTINATION ROLE.
//    `false -> true` -> every current assignee.
//  - Delivery is best-effort AT-MOST-ONCE: each attempt is logged and swallowed,
//    never rolled back into content, and one failure never skips the rest. There
//    is exactly one deferred attempt per committed request, so an HTTP retry that
//    replays idempotently produces no second attempt. No exactly-once claim is
//    made — that would need an outbox.
//
// Reads here go through the canonical operational client, so the audience is the
// published perspective and a `drafts.*` overlay can never widen it.

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { revalidateServiceViews } from "./revalidate";
import { sendPush } from "./push";
import {
  sendAssignmentEmails,
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
 * A published (or grandfathered: `published` absent) edit / swap / copy notifies
 * only the assignees this operation ADDED to that destination role. A draft, a
 * removal and a no-op change are silent.
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
 * ONE deferred fan-out for a whole committed batch: a push plus a single-service
 * assignment email per destination role. `null`/empty notices are dropped, so a
 * batch with nothing to say registers no attempt at all.
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
      await attempt("assignment email", () =>
        sendAssignmentEmails(notice.recipients, {
          type: notice.type,
          date: notice.date,
          body: notice.body,
        }),
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
