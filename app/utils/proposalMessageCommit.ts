import "server-only";

// Both sides of a setlist proposal's private thread (Child A §4). The lead's was moved here from
// `app/api/me/proposals/[id]/messages/route.ts` so the native app's door can call the same writer
// (W1b spec, `docs/superpowers/specs/2026-11-27-native-proposal-message-design.md`; ADR-0091); the
// admin's from `app/api/admin/proposals/[id]/messages/route.ts`, for the same reason (A-W1 spec,
// `docs/superpowers/specs/2026-11-27-native-admin-proposal-review-design.md`).
// Every route that calls this is a route handler (`serviceCommitCallers.test.ts`), so `after()`
// has its request scope.

import { after } from "next/server";

import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { queueLeadNotesNotice } from "@/app/utils/serviceMutationSideEffects";
import { serviceError } from "@/app/utils/serviceMutation";
import { canonicalLeadRefs } from "@/app/utils/serviceReadSelect";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { nextKey, nowIso } from "@/app/utils/roleWriteOps";
import { loadCanonicalProposal } from "@/app/utils/serviceWriteTargets";
import {
  buildProposalMessage,
  parseProposalMessageRequest,
  PROPOSAL_MESSAGES_MAX,
  isLeadNote,
} from "@/app/utils/proposalMessageWrite";
import { isThreadOpen } from "@/app/utils/proposalThread";
import { THREAD_AFTER_APPEND_QUERY, type ThreadMessageRow } from "@/app/utils/proposalMessageRead";
import { attempt, attemptSync, notifyProposalReview } from "@/app/utils/serviceMutationSideEffects";
import { ADMIN_RECIPIENTS_QUERY } from "@/app/utils/proposalNotifyQueries";
import { sendPush } from "@/app/utils/push";

/** What a door answers: the status and the JSON body, exactly as the web route always did. */
export interface ProposalMessageResult {
  status: number;
  body: unknown;
}

function reject(res: { status: number; body: unknown }): ProposalMessageResult {
  return { status: res.status, body: res.body };
}

/**
 * Push the admins about a lead's message on an APPROVED proposal.
 *
 * `ADMIN_RECIPIENTS_QUERY` carries no ministry or active-member filter. Inherited
 * from the two copies Child B Phase A collapsed into it, NOT introduced here, and
 * recorded so a later reader does not re-litigate it as new — it is
 * FrankERP/owt-kb-v1#8. What this call does add is frequency: the audience used
 * to be resolved on transitions and submissions only, and now it is resolved per
 * message.
 *
 * The AUTHOR is filtered out. A lead who is also an `admin` is in that set, and
 * nothing else removes them.
 *
 * `path: "/admin"` — the admin surface. `notifyProposalReview` hardcodes `/me`,
 * which is the LEAD's home and wrong for this audience.
 *
 * THE DATE IS RENDERED AT LOCAL NOON. A bare `new Date(iso)` day-flips in
 * America/Mexico_City. The precedent to copy is `proposalNotify`; the precedent
 * NOT to copy is `assignmentPush`, which interpolates the raw stored value into a
 * push body with no rendering at all.
 *
 * THE AUTHOR NAME IS THE DOOR'S `authorName`. The web route passes its caller's
 * SESSION — no read at all (what follows explains why). The native app's door has
 * no name in its token, so it passes ONE guarded live read of the member's
 * `coalesce(alias, member_name)`, `""` on failure (W1b): the same person's push
 * can therefore be worded from a newer alias on the app than on the web. The
 * author IS the caller. The plan said to reuse the name the route resolved for its
 * response; that one is the POST-COMMIT read-back, deliberately guarded and null
 * on failure, so it cannot be relied on — the session is a third option needing
 * neither.
 *
 * WHAT THE SESSION ACTUALLY CARRIES, stated precisely because "the same fields"
 * is not quite true: `alias` is `teamMembers.alias`, matching the removed query's
 * first choice. `name` is `member_name` on the credentials and native-Google
 * paths, but on WEB Google SSO it is the Google profile name. Neither is
 * refreshed on an ordinary session — both are snapshotted at sign-in for the
 * token's life, so an alias edit does not reach a push body until the member
 * signs in again. (Starting impersonation is the one exception: that branch
 * re-reads both live from Sanity. STOPPING it restores the snapshot taken at
 * start, which was itself the admin's sign-in snapshot — no read.) All of it is cosmetic — the push says
 * who wrote, and every variant names the right person.
 *
 * Using the session also decouples the body's decoration from the delivery. An
 * earlier version fetched the name alongside the audience in a `Promise.all`,
 * where a transient failure on the COSMETIC read rejected the whole thing and no
 * push was sent at all.
 *
 * On the web, the nameless fallback is defence, not a path with a known trigger
 * (on the app, a failed name read reaches it). NOT
 * impersonation — that branch sets both `name` and `alias` from the target
 * member, so an impersonated session is named like any other.
 */
async function pushAdminsAboutLeadMessage(o: {
  authorId: string;
  authorName: string;
  serviceDate: string;
}): Promise<void> {
  const adminIds = await operationalClient.fetch<string[] | null>(ADMIN_RECIPIENTS_QUERY);
  const recipients = (adminIds ?? []).filter((id) => id && id !== o.authorId);
  if (!recipients.length) return;

  const name = o.authorName;
  const when = o.serviceDate
    ? new Date(`${o.serviceDate.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", {
        day: "numeric",
        month: "short",
      })
    : "";
  const where = when ? ` del ${when}` : "";
  const body = name
    ? `${name} escribió en la propuesta${where}.`
    : `Hay un mensaje nuevo en la propuesta${where}.`;

  await sendPush(recipients, "proposals", { title: "Nuevo mensaje", body, path: "/admin" });
}

/**
 * A lead posts into the private thread: the domain body of `POST /api/me/proposals/[id]/messages`,
 * moved here so the native app's door (`POST /api/app/v1/proposal-messages/[proposalId]`,
 * ADR-0091 W1b) calls the same writer. Each door keeps only its own authorization and the JSON
 * read; `leadId` is the ONE identity input, `authorName` only words the approved-proposal push,
 * and nothing below reads a session. `serviceCommitCallers.test.ts` pins who may import this.
 *
 * Three things about this route are deliberate and easy to "fix" wrongly:
 *
 * 1. **No `ifRevisionId`.** Two co-leads posting at the same moment must both
 *    land. A revision precondition would 409 one of them, in a channel whose
 *    whole promise is that nothing is lost. Not read-modify-write.
 * 2. **`setIfMissing` before `append` is mandatory**, not defensive. Sanity
 *    rejects an append to an absent array, so without it the first message fails
 *    on every proposal the migration did not touch and every proposal created
 *    afterwards. Precedent: `app/api/me/push-token/route.ts:19-23`.
 * 3. **`isThreadOpen` is enforced HERE, not only in the UI.** A hidden composer
 *    is not a guard.
 */
export async function postProposalMessage(input: {
  /** The caller's member id, from the door's own authorization. */
  leadId: string;
  /** The caller's display name, for the approved-proposal push only; `""` = the nameless wording. */
  authorName: string;
  /** The proposal id as the door received it. */
  proposalId: string;
  /** The JSON body as read; parsed HERE, so the parser stays part of the trust boundary. */
  raw: unknown;
}): Promise<ProposalMessageResult> {
  const { leadId, authorName, raw } = input;
  const id = input.proposalId;

  const parsed = parseProposalMessageRequest(raw);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }

  // Canonical identity, never `raw`/`[0]`: a draft-overlaid or ambiguous proposal
  // fails closed rather than taking a message onto an untrusted document.
  const load = await loadCanonicalProposal(id);
  if (!load.ok) {
    return reject(serviceError(load.failure.code, { details: load.failure.details }));
  }
  const { doc, role } = load.proposal;

  // Both halves of the member-facing gate the save route applies: a Lead on the
  // service, AND the service is not an admin-only draft.
  if (role.published === false || !canonicalLeadRefs(role).includes(leadId)) {
    return { status: 403, body: { error: "Not a Lead on this service" } };
  }

  // The conversation closes when the SERVICE has passed, not when the proposal is
  // approved — an admin must be able to ask about a published setlist without
  // reopening it. Fails closed on an unusable date, because this authorizes a write.
  if (!isThreadOpen({ serviceDate: doc.service_date })) {
    return reject(serviceError("invalid_request", { details: { issues: ["thread_closed"] } }));
  }

  const stored = Array.isArray(doc.messages) ? (doc.messages as unknown[]) : [];
  // A growth bound, NOT a security boundary: checked against the loaded document,
  // so two concurrent posts at 199 both pass and both land. Deliberate — see
  // `PROPOSAL_MESSAGES_MAX`.
  if (stored.length >= PROPOSAL_MESSAGES_MAX) {
    return reject(serviceError("invalid_request", { details: { issues: ["messages_full"] } }));
  }

  const message = buildProposalMessage({
    authorId: leadId,
    authorRole: "lead",
    kind: "lead_note",
    body: parsed.value.body,
    now: nowIso(),
    key: nextKey(),
  });
  if (!message) {
    return reject(serviceError("invalid_request", { details: { issues: ["body"] } }));
  }

  // The revision read immediately BEFORE this append (§5). The surfaces compare it
  // against the one they were rendering to decide whether anything OTHER than this
  // post moved the document — not against the fresh `_rev`, which this append
  // always moves.
  const observedRev = typeof doc._rev === "string" ? doc._rev : null;

  // PRE-COMMIT, for the notice. Reading these after the write gives post-write
  // state and the debounced email silently sends nothing.
  //
  // `lead_notes` is no longer written by this route — the mirror is gone. It is
  // still READ, and must be: the snapshot is what production's old sweep compares
  // against during the release window, and it is now the value that makes that
  // window silent rather than stale, because nothing moves the field any more.
  const beforeNotes = typeof doc.lead_notes === "string" ? doc.lead_notes : "";
  const previousStatus = doc.status;
  // The index the flush slices the thread from: LEAD NOTES only, counted with the
  // same predicate `LEAD_NOTE_MESSAGES` filters on. `stored` is the pre-commit
  // array this handler already read, so this is not a second fetch. Counting
  // `stored.length` instead would silently empty the batch on every proposal
  // carrying an admin message — the normal shape of one that has been reviewed.
  const beforeMessageCount = stored.filter(isLeadNote).length;

  try {
    await writeClient
      .patch(id)
      .setIfMissing({ messages: [] })
      .append("messages", [message])
      .commit();
  } catch (err) {
    // With no `ifRevisionId` a 409 is not a stale-revision race — the patch
    // asserts nothing — so this is a genuine Sanity write conflict. Mapped onto
    // the registered code rather than re-exposing `sanityConflictKind`'s own
    // union, exactly as the save route does.
    if (!sanityConflictKind(err)) throw err;
    return reject(serviceError("stale_revision", { details: { id } }));
  }

  // Post-commit, with the PRE-COMMIT snapshot threaded in. This route's body can
  // never be empty (`buildProposalMessage` returned non-null), so it always
  // appended something and the notice is never spurious.
  queueLeadNotesNotice({
    proposalId: id,
    serviceDate: typeof doc.service_date === "string" ? doc.service_date : "",
    previousStatus,
    beforeNotes,
    beforeMessageCount,
  });

  // The lead→admin push, and it exists because the outbox email does NOT cover
  // `approved` (Child B §Notifications). Both outbox gates are
  // `{pending, changes_requested}` while the composer stays open on `approved`,
  // and most proposals ARE approved — so without this a lead could post where no
  // admin ever learns of it.
  //
  // THE GATE IS `status === "approved"`, nothing looser. "A status the outbox
  // will not cover" is a NECESSARY condition only: read as sufficient it fires on
  // `draft` too, which must stay silent because a draft is not in front of admins
  // yet. ONE signal per message, never both — an email or a push.
  //
  // `previousStatus` is the pre-commit status, the same value the notice gate
  // reads. An append does not move `status`, so pre and post agree here; using
  // the snapshot keeps the two gates reading one value.
  if (String(previousStatus ?? "") === "approved") {
    // INSIDE `after()`, AND the callback AWAITS the promise. Both halves are
    // load-bearing and only the first is obvious: `after(() => fireAndForget(p))`
    // hands the queue a `void`, so it goes idle at once and `waitUntil` settles
    // while the send is still in flight — worse than firing inline, because
    // nothing else is left running to overlap it. That version shipped here once.
    //
    // This path needs the hold more than most: on `approved`,
    // `queueLeadNotesNotice` returns on its status gate BEFORE registering its
    // own `after()`, so this is the handler's ONLY deferred work. Losing it means
    // a stored message that notified nobody, with no log and no outbox row.
    //
    // `attempt` swallows and logs, so a push failure cannot surface as an
    // unhandled rejection on an already-committed write.
    //
    // The REGISTRATION is guarded too: `after()` throws synchronously when there
    // is no request scope, and this runs after the commit — an uncaught throw
    // here would 500 a message that already landed, and the obvious user action
    // is to send it again.
    attemptSync("proposal lead message push register", () =>
      after(() =>
        attempt("proposal lead message push", () =>
          pushAdminsAboutLeadMessage({
            authorId: leadId,
            authorName,
            serviceDate: typeof doc.service_date === "string" ? doc.service_date : "",
          }),
        ),
      ),
    );
  }

  // The read-back is for the RESPONSE ONLY — the write already committed. It is
  // guarded because throwing here would report a landed message as a failure,
  // and the obvious user action is to press Enviar again: this delivery ships no
  // delete path, so that retry is a permanent duplicate in the one channel whose
  // promise is that nothing is lost.
  //
  // On failure the response says so with `messages: null`, which both clients
  // read as "keep what you have, clear the composer" rather than blanking the
  // thread they are rendering.
  let fresh: { _rev?: string; messages?: ThreadMessageRow[] | null } | null = null;
  try {
    fresh = await operationalClient.fetch<{
      _rev?: string;
      messages?: ThreadMessageRow[] | null;
    } | null>(THREAD_AFTER_APPEND_QUERY, { id });
  } catch (err) {
    console.error("[proposalMessages] post-commit read failed:", err);
  }

  return {
    status: 200,
    body: {
    ok: true,
    message,
    // `null`, not `[]`: an empty array is a real state (nothing to show) and
    // must not be confused with "the read did not happen".
    messages: fresh ? (fresh.messages ?? []) : null,
    rev: fresh?._rev ?? null,
    observedRev,
    },
  };
}

/**
 * An admin posts into the private thread — the domain body of
 * `POST /api/admin/proposals/[id]/messages`, moved here verbatim so the native app's door
 * (`POST /api/app/v1/admin/proposal-messages/[proposalId]`) calls the same code. The callers keep
 * only their authorization (an active manager who is not a content-editor) and the JSON read.
 *
 * **This writer does NOT touch `admin_notes`, and neither does anything else.**
 * The transition was that field's last writer and Child B stopped it too, so it
 * is a FROZEN change-request archive rather than one anybody keeps current. This
 * writer never wrote it even while the transition did, for a reason that still
 * stands on a rollback: letting ordinary admin chatter overwrite it would make a
 * question indistinguishable from a review decision. It has no notification
 * consumer, so there is nothing to keep in sync.
 *
 * **`kind` is `admin_change_request`** because that is the only admin-facing value
 * the enum offers — `pastor_note` and `system` are reserved and unminted (§3). The
 * consequence is real and accepted for this child: an admin's *question* is stored
 * as a change request, and Studio labels it "Cambios solicitados". A distinct
 * `admin_note` kind is a schema change and belongs with pastor notes.
 *
 * **No ministry check, inherited deliberately** from the sibling transition writer
 * (`admin/proposals/[id]/route.ts`), so a kids-only `admin` can post into a worship
 * thread. A new writer stricter than the route beside it would give two answers to
 * "can this admin act on this proposal"; tightening both is FrankERP/owt-kb-v1#8.
 */
export async function postAdminProposalMessage(input: {
  /** The caller's member id — the ONE identity input. `null` as the web session allows. */
  adminId: string | null;
  /** The path segment, as the route received it. */
  proposalId: string;
  /** The JSON body as read; parsed here. */
  raw: unknown;
}): Promise<ProposalMessageResult> {
  const { adminId, proposalId: id, raw } = input;

  const parsed = parseProposalMessageRequest(raw);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }

  const load = await loadCanonicalProposal(id);
  if (!load.ok) {
    return reject(serviceError(load.failure.code, { details: load.failure.details }));
  }
  const { doc } = load.proposal;

  // Server-side, not a UI state. See the lead writer.
  if (!isThreadOpen({ serviceDate: doc.service_date })) {
    return reject(serviceError("invalid_request", { details: { issues: ["thread_closed"] } }));
  }

  const stored = Array.isArray(doc.messages) ? (doc.messages as unknown[]) : [];
  // Racy by construction; a growth bound, not a boundary. The TRANSITION is exempt
  // from this cap — a full thread must never block a review decision — but a chat
  // message is not a decision.
  if (stored.length >= PROPOSAL_MESSAGES_MAX) {
    return reject(serviceError("invalid_request", { details: { issues: ["messages_full"] } }));
  }

  const message = buildProposalMessage({
    authorId: adminId,
    authorRole: "admin",
    kind: "admin_change_request",
    body: parsed.value.body,
    now: nowIso(),
    key: nextKey(),
  });
  if (!message) {
    return reject(serviceError("invalid_request", { details: { issues: ["body"] } }));
  }

  const observedRev = typeof doc._rev === "string" ? doc._rev : null;
  // PRE-COMMIT: the push below reads it, and the read-back that follows the
  // commit is guarded and may return null. Nothing about the audience changes
  // between here and there — `doc.lead` and `doc.contributors` are not touched
  // by an append — but taking it from the loaded document keeps the push off the
  // guarded read entirely.
  const pushDoc = doc;

  try {
    // No `ifRevisionId`, and `setIfMissing` before `append` — both for the same
    // reasons as the lead writer, which documents them.
    await writeClient
      .patch(id)
      .setIfMissing({ messages: [] })
      .append("messages", [message])
      .commit();
  } catch (err) {
    // With no `ifRevisionId` a 409 is not a stale-revision race — the patch
    // asserts nothing — so this is a genuine Sanity write conflict. Mapped onto
    // the registered code rather than re-exposing `sanityConflictKind`'s own
    // union, exactly as the save writer does.
    if (!sanityConflictKind(err)) throw err;
    return reject(serviceError("stale_revision", { details: { id } }));
  }

  // The other half of the conversation (Child B). A standalone admin message
  // notified NOBODY before this: the transition pushes on `request_changes` and
  // `reopen`, but an admin asking a question in the thread was silent.
  //
  // NEW COPY, deliberately. Reusing `REVIEW_PUSH.request_changes` would push
  // "Cambios solicitados — Revisaron la propuesta y pidieron cambios" when an
  // admin merely asked something, which is worse than saying nothing.
  //
  // `notifyProposalReview` is the right helper here because the RECIPIENT is the
  // lead, not because of the arrow's direction — and the author is excluded
  // through its third parameter rather than here, so the audience rule stays
  // written down once.
  //
  // INSIDE `after()`, and the callback AWAITS — see the lead writer for why the
  // second half matters as much as the first. `awaitDelivery` is what makes the
  // await reach FCM: `notifyProposalReview` is fire-and-forget INSIDE by default,
  // so awaiting it without that flag would resolve before the send and hold
  // nothing. This writer registers no other deferred work.
  //
  // `attempt` swallows and logs, so a push failure cannot turn a stored message
  // into an error response — that would invite a retry this delivery cannot undo.
  // The REGISTRATION is guarded for the same reason: `after()` throws
  // synchronously outside a request scope, and this runs after the commit.
  attemptSync("proposal admin message push register", () =>
    after(() =>
      attempt("proposal admin message push", () =>
        notifyProposalReview(
          pushDoc,
          {
            title: "Nuevo mensaje",
            body: "Un admin escribió en la propuesta.",
          },
          adminId ? [adminId] : [],
          { awaitDelivery: true },
        ),
      ),
    ),
  );

  // The read-back is for the RESPONSE ONLY — the write already committed. It is
  // guarded because throwing here would report a landed message as a failure,
  // and the obvious user action is to press Enviar again: this delivery ships no
  // delete path, so that retry is a permanent duplicate in the one channel whose
  // promise is that nothing is lost.
  //
  // On failure the response says so with `messages: null`, which every client
  // reads as "keep what you have, clear the composer" rather than blanking the
  // thread they are rendering. Its `rev` is NOT the revision the admin reviewed:
  // other writes can land between the load and this read, so a client must never
  // adopt it as the revision it decides on (A-W1 spec D4).
  let fresh: { _rev?: string; messages?: ThreadMessageRow[] | null } | null = null;
  try {
    fresh = await operationalClient.fetch<{
      _rev?: string;
      messages?: ThreadMessageRow[] | null;
    } | null>(THREAD_AFTER_APPEND_QUERY, { id });
  } catch (err) {
    console.error("[proposalMessages] post-commit read failed:", err);
  }

  return {
    status: 200,
    body: {
      ok: true,
      message,
      // `null`, not `[]`: an empty array is a real state (nothing to show) and
      // must not be confused with "the read did not happen".
      messages: fresh ? (fresh.messages ?? []) : null,
      rev: fresh?._rev ?? null,
      observedRev,
    },
  };
}
