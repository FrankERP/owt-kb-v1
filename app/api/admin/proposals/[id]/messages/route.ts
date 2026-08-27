import { after, NextRequest, NextResponse } from "next/server";

// Kept at 60 s to match its sibling writers. This route registers no OUTBOX
// fan-out — an admin message queues no debounced email, which was Child A §1's
// named gap — but since Child B it does register an `after()`: the push that
// closes that gap by telling the lead. The budget is what keeps that deferred
// work alive after the response returns.
export const maxDuration = 60;

import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serviceError } from "@/app/utils/serviceMutation";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { nextKey, nowIso } from "@/app/utils/roleWriteOps";
import { loadCanonicalProposal } from "@/app/utils/serviceWriteTargets";
import { attempt, attemptSync, notifyProposalReview } from "@/app/utils/serviceMutationSideEffects";
import {
  buildProposalMessage,
  parseProposalMessageRequest,
  PROPOSAL_MESSAGES_MAX,
} from "@/app/utils/proposalMessageWrite";
import { isThreadOpen } from "@/app/utils/proposalThread";
import { THREAD_AFTER_APPEND_QUERY, type ThreadMessageRow } from "@/app/utils/proposalMessageRead";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

// Declared BEFORE the handler on purpose, matching `app/api/me/proposals/route.ts`.
// `protectedReadAudit`'s `operationRegions` treats `export const POST =` as the
// START of the POST region, so declaring it at the bottom files every mutation in
// this file under `module` and the writer entry reads as dead. Hoisting makes it
// work at runtime either way; the audit is what fixes the order.
export const POST = withVerificationRunContext(postHandler);

/**
 * POST /api/admin/proposals/[id]/messages — an admin posts into the private thread.
 *
 * **This route does NOT touch `admin_notes`, and neither does anything else.**
 * The transition was that field's last writer and Child B stopped it too, so it
 * is a FROZEN change-request archive rather than one anybody keeps current. This
 * route never wrote it even while the transition did, for a reason that still
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
async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireActiveManager();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Restricted to admin and super-admin (not content-editor), matching the
  // transition route this one sits beside.
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const adminId = session.user.sanityId ?? null;

  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const parsed = parseProposalMessageRequest(raw);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }

  const load = await loadCanonicalProposal(id);
  if (!load.ok) {
    return reject(serviceError(load.failure.code, { details: load.failure.details }));
  }
  const { doc } = load.proposal;

  // Server-side, not a UI state. See the lead route.
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
    // reasons as the lead route, which documents them.
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
  // through its third parameter rather than in this route, so the audience rule
  // stays written down once.
  //
  // INSIDE `after()`, and the callback AWAITS — see the lead route for why the
  // second half matters as much as the first. `awaitDelivery` is what makes the
  // await reach FCM: `notifyProposalReview` is fire-and-forget INSIDE by default,
  // so awaiting it without that flag would resolve before the send and hold
  // nothing. This route registers no other deferred work.
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

  return NextResponse.json({
    ok: true,
    message,
    // `null`, not `[]`: an empty array is a real state (nothing to show) and
    // must not be confused with "the read did not happen".
    messages: fresh ? (fresh.messages ?? []) : null,
    rev: fresh?._rev ?? null,
    observedRev,
  });
}
