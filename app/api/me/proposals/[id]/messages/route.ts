import { NextRequest, NextResponse } from "next/server";

// This route hosts the same post-commit `after()` fan-out as the save route:
// `queueLeadNotesNotice` registers a deferred `commitUpserts`, which runs an
// inline `sweepOutbox` at roughly 14 s per send. Give it room past the response.
export const maxDuration = 60;

import { requireMinistryMember } from "@/app/utils/authGuards";
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
 * POST /api/me/proposals/[id]/messages — a lead posts into the private thread.
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
async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Setlist proposals are a worship surface; membership, not just a session.
  const session = await requireMinistryMember("worship");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const leadId = session.user.sanityId;
  if (!leadId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    return NextResponse.json({ error: "Not a Lead on this service" }, { status: 403 });
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
