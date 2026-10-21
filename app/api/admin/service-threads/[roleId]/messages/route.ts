import { after, NextRequest, NextResponse } from "next/server";

// Matches the sibling message writers: the push and email to the leads run in
// `after()`, and the budget is what keeps them alive past the response.
export const maxDuration = 60;

import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serviceError } from "@/app/utils/serviceMutation";
import { isCanonicalDocumentId, sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { loadCanonicalRole, nextKey, nowIso } from "@/app/utils/roleWriteOps";
import { canonicalLeadRefs } from "@/app/utils/serviceReadSelect";
import { targetFromCanonicalRole } from "@/app/utils/proposalWriteRequest";
import { attempt, attemptSync } from "@/app/utils/serviceMutationSideEffects";
import {
  buildProposalMessage,
  parseProposalMessageRequest,
  PROPOSAL_MESSAGES_MAX,
} from "@/app/utils/proposalMessageWrite";
import { isThreadOpen } from "@/app/utils/proposalThread";
import type { ThreadMessageRow } from "@/app/utils/proposalMessageRead";
import {
  SERVICE_THREAD_BY_ID_QUERY,
  SERVICE_THREAD_TYPE,
  serviceThreadId,
} from "@/app/utils/serviceThread";
import { notifyLeadsAboutServiceMessage } from "@/app/utils/serviceThreadNotify";
import { serviceIdentity } from "@/app/utils/emailServiceLabel";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

// Declared BEFORE the handler, like the proposal message routes:
// `protectedReadAudit` treats `export const POST =` as the start of the POST region.
export const POST = withVerificationRunContext(postHandler);

/**
 * POST /api/admin/service-threads/[roleId]/messages — an admin writes about a
 * service whose setlist proposal does not exist yet (ADR-0064).
 *
 * The message lands in `serviceThread.<roleId>`, NOT in a proposal: minting a
 * proposal to hold a message would make the role undeletable and immovable
 * (`roleDependencies` blocks on any proposal) and turn its readiness into
 * "Revisar propuesta". Both readers (the admin card, the lead's editor) show this
 * thread together with the proposal's own once the leads create one.
 *
 * Deliberate, and the same as `admin/proposals/[id]/messages`:
 *  - **No `ifRevisionId`.** Two admins posting at once must both land.
 *    `createIfNotExists` + `setIfMissing` + `append` in one transaction is what
 *    makes the first message and every later one the same write.
 *  - **`isThreadOpen` is enforced here**, not only in the UI.
 *  - **`kind: "admin_change_request"`** — the only admin-facing kind the message
 *    enum offers; see the proposal messages route for why.
 *
 * Accepted even if a proposal appeared since the admin's list loaded: the
 * message still shows on that proposal (both threads are read together), so
 * refusing would only make the admin retype it.
 *
 * **No ministry check**, inherited deliberately from the proposal message route
 * beside it, so a kids-only `admin` can post here; tightening both is
 * FrankERP/owt-kb-v1#8.
 *
 * Nothing to revalidate: no ISR page reads this document (the proposal page is
 * `revalidate = 0`, the admin list is an API read).
 */
async function postHandler(req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  const session = await requireActiveManager();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Admin and super-admin only (not content-editor), like the proposal message route.
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const adminId = session.user.sanityId ?? null;

  const { roleId } = await params;
  const threadId = serviceThreadId(roleId);
  if (!isCanonicalDocumentId(roleId) || !threadId) {
    return reject(serviceError("invalid_request", { details: { issues: ["roleId"] } }));
  }

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

  const lookup = await loadCanonicalRole(roleId);
  if (lookup.state === "none" || !lookup.role) {
    return reject(serviceError("not_found", { details: { roleId } }));
  }
  if (lookup.state !== "single") {
    return reject(serviceError("ambiguous_target", { details: { roleId, state: lookup.state } }));
  }
  const role = lookup.role;
  const target = targetFromCanonicalRole(role);
  if (!target) {
    return reject(serviceError("integrity_conflict", { details: { roleId, detail: "role_target" } }));
  }
  if (!isThreadOpen({ serviceDate: target.serviceDate })) {
    return reject(serviceError("invalid_request", { details: { issues: ["thread_closed"] } }));
  }

  // A growth bound, not a boundary — racy by construction, as on the proposal.
  const existing = await operationalClient.fetch<{ count?: number } | null>(
    `*[_type == "${SERVICE_THREAD_TYPE}" && _id == $threadId][0]{ "count": count(messages) }`,
    { threadId },
  );
  if ((existing?.count ?? 0) >= PROPOSAL_MESSAGES_MAX) {
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

  // PRE-COMMIT: the audience is the role's Lead seat as loaded here, and the
  // email's service label comes from the same read.
  const leadIds = canonicalLeadRefs(role);
  const published = role.published !== false;
  const authorName = session.user.alias || session.user.name || "";

  try {
    await writeClient
      .transaction()
      .createIfNotExists({
        _id: threadId,
        _type: SERVICE_THREAD_TYPE,
        // A plain STRING, never a reference — not even a weak one. GROQ's
        // `references()` matches weak references too, and `roleDependencies`
        // turns every document referencing a role into a dependency: one message
        // would block «Limpiar mes», a role delete and a date move.
        role_id: roleId,
        messages: [],
      })
      .patch(threadId, (p) => p.setIfMissing({ messages: [] }).append("messages", [message]))
      .commit();
  } catch (err) {
    // Nothing is asserted, so a 409 is a genuine Sanity write conflict.
    if (!sanityConflictKind(err)) throw err;
    return reject(serviceError("stale_revision", { details: { id: threadId } }));
  }

  // Push AND email to the service's leads (never the author) — see
  // `serviceThreadNotify.ts` for why this differs from a proposal's admin message.
  // Skipped for an unpublished service: its leads cannot open the proposal page
  // yet (it 404s on `published == false`); they read it once the month is.
  //
  // Swallowed and logged: a delivery failure must not turn a stored message into
  // an error response (the retry would be a permanent duplicate). The callback
  // AWAITS so delivery finishes before the runtime freezes the instance.
  if (published) {
    attemptSync("service thread message notify register", () =>
      after(() =>
        attempt("service thread message notify", () =>
          notifyLeadsAboutServiceMessage({
            leadIds,
            authorId: adminId,
            authorName,
            roleId,
            roleType: role._type,
            serviceDate: target.serviceDate,
            identity: serviceIdentity(role),
            body: message.body,
          }),
        ),
      ),
    );
  }

  // The read-back is for the RESPONSE ONLY and is guarded: the write already
  // committed, and `messages: null` tells the client to keep what it shows.
  let fresh: { messages?: ThreadMessageRow[] | null } | null = null;
  try {
    fresh = await operationalClient.fetch<{ messages?: ThreadMessageRow[] | null } | null>(
      SERVICE_THREAD_BY_ID_QUERY,
      { threadId },
    );
  } catch (err) {
    console.error("[serviceThread] post-commit read failed:", err);
  }

  return NextResponse.json({
    ok: true,
    message,
    messages: fresh ? (fresh.messages ?? []) : null,
  });
}
