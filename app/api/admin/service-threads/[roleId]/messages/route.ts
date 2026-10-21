import { after, NextRequest, NextResponse } from "next/server";

// Matches the sibling message writers: the push to the leads runs in `after()`,
// and the budget is what keeps it alive past the response.
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
import { sendPush } from "@/app/utils/push";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/**
 * Push the service's leads that an admin wrote about it. Push only, like an
 * admin message on a proposal — no email: the app mails through a free Gmail
 * account, and a chat message must not become a fan-out (ADR-0025).
 *
 * Skipped for an unpublished service: its leads cannot open the proposal page
 * yet (it 404s on `published == false`), so the push would lead nowhere. They
 * read the message once the month is published.
 *
 * The date is rendered at local noon — never a bare `new Date(iso)`.
 */
async function pushLeadsAboutServiceMessage(o: {
  leadIds: string[];
  authorId: string | null;
  roleId: string;
  serviceDate: string;
}): Promise<void> {
  const recipients = o.leadIds.filter((id) => id && id !== o.authorId);
  if (!recipients.length) return;
  const when = new Date(`${o.serviceDate.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
  await sendPush(recipients, "proposals", {
    title: "Nuevo mensaje",
    body: `Un admin escribió sobre el servicio del ${when}.`,
    path: `/me/propose/${encodeURIComponent(o.roleId)}`,
  });
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

  // PRE-COMMIT: the push audience is the role's Lead seat as loaded here.
  const leadIds = canonicalLeadRefs(role);
  const published = role.published !== false;

  try {
    await writeClient
      .transaction()
      .createIfNotExists({
        _id: threadId,
        _type: SERVICE_THREAD_TYPE,
        // Weak: a strong reference would block deleting the role.
        service_ref: { _type: "reference", _ref: roleId, _weak: true },
        messages: [],
      })
      .patch(threadId, (p) => p.setIfMissing({ messages: [] }).append("messages", [message]))
      .commit();
  } catch (err) {
    // Nothing is asserted, so a 409 is a genuine Sanity write conflict.
    if (!sanityConflictKind(err)) throw err;
    return reject(serviceError("stale_revision", { details: { id: threadId } }));
  }

  // Swallowed and logged: a push failure must not turn a stored message into an
  // error response (the retry would be a permanent duplicate). The callback
  // AWAITS so the send finishes before the runtime freezes the instance.
  if (published) {
    attemptSync("service thread message push register", () =>
      after(() =>
        attempt("service thread message push", () =>
          pushLeadsAboutServiceMessage({
            leadIds,
            authorId: adminId,
            roleId,
            serviceDate: target.serviceDate,
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
