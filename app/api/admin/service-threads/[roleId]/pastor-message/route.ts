import { after, NextRequest, NextResponse } from "next/server";

// The push and email to the leads run in `after()`, like the message POST beside it.
export const maxDuration = 60;

import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serviceError } from "@/app/utils/serviceMutation";
import { isCanonicalDocumentId, sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { loadCanonicalRole, nowIso } from "@/app/utils/roleWriteOps";
import { canonicalLeadRefs } from "@/app/utils/serviceReadSelect";
import { targetFromCanonicalRole } from "@/app/utils/proposalWriteRequest";
import { attempt, attemptSync } from "@/app/utils/serviceMutationSideEffects";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import {
  PASTOR_MESSAGE,
  SERVICE_THREAD_TYPE,
  serviceThreadId,
  type PastorMessageRow,
} from "@/app/utils/serviceThread";
import { parsePastorMessageEdit, pastorMessageStamp } from "@/app/utils/serviceMessageEdit";
import { notifyLeadsAboutServiceMessage } from "@/app/utils/serviceThreadNotify";
import { serviceIdentity } from "@/app/utils/emailServiceLabel";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

interface StoredThread {
  _id: string;
  _rev: string;
  pastor_message?: { body?: string; at?: string; edited_at?: string; author?: { _ref?: string } } | null;
}

// Declared BEFORE the handler: `protectedReadAudit` treats `export const PUT =` as
// the start of the PUT region.
export const PUT = withVerificationRunContext(putHandler);

/**
 * PUT /api/admin/service-threads/[roleId]/pastor-message — set, edit or clear
 * the service's ONE «Mensaje del pastor» (ADR-0065, amended 2026-10-24).
 *
 * Body `{ body, observed }`: `body` empty clears it; `observed` is the stamp the
 * admin saw (`edited_at ?? at`, or null for none). A different stored stamp is a
 * 409 — two admins editing at once never silently overwrite each other — and the
 * write asserts the thread's `_rev` read here, so nothing lands in between.
 * The stamp, not the thread's `_rev`, is what the client observes: a chat message
 * appended meanwhile changes the `_rev` but not the pastor's message, and must
 * not make the admin redo an edit that conflicts with nothing.
 *
 * It lives on `serviceThread.<roleId>`, never on the role (every role writer
 * asserts the role `_rev`) and never on a proposal (ADR-0065).
 *
 * Notifies the leads (push AND email, `pastor: true`) only when a message
 * APPEARS on a published service. An edit or a clear sends nothing: a typo fix
 * must not mail the leads again, and the DayCard always shows the current text.
 */
async function putHandler(req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  const session = await requireActiveManager();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  const parsed = parsePastorMessageEdit(raw);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const { body, observed } = parsed.value;

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

  const stored = await operationalClient.fetch<StoredThread | null>(
    `*[_type == "${SERVICE_THREAD_TYPE}" && _id == $threadId][0]{ _id, _rev, pastor_message }`,
    { threadId },
  );
  const before = stored?.pastor_message?.body ? stored.pastor_message : null;
  if (pastorMessageStamp(before) !== observed) {
    return reject(serviceError("stale_revision", { details: { id: threadId, detail: "pastor_message_moved" } }));
  }

  const now = nowIso();
  const author = adminId ? { author: { _ref: adminId, _type: "reference" as const } } : {};
  const next = body
    ? {
        _type: "pastor_message",
        body,
        ...author,
        // First set keeps its moment; every later save is an edit.
        at: before?.at ?? now,
        ...(before ? { edited_at: now } : {}),
      }
    : null;

  if (!next && !before) {
    // Clearing what is not there: nothing to write.
    return NextResponse.json({ ok: true, pastor_message: null });
  }

  try {
    if (stored) {
      const patch = writeClient.patch(threadId).ifRevisionId(stored._rev);
      await (next ? patch.set({ pastor_message: next }) : patch.unset(["pastor_message"])).commit();
    } else {
      // `create`, never `createIfNotExists`: a thread created meanwhile (a chat
      // message) must be TOLD, and the admin retries against it.
      await writeClient.create({
        _id: threadId,
        _type: SERVICE_THREAD_TYPE,
        // A plain string, never a reference (ADR-0065).
        role_id: roleId,
        messages: [],
        pastor_message: next,
      });
    }
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    return reject(serviceError("stale_revision", { details: { id: threadId } }));
  }

  revalidateServiceViews();

  // Only a message that APPEARS notifies, and only on a published service (its
  // leads cannot open the proposal page while it is a draft).
  if (next && !before && role.published !== false) {
    const leadIds = canonicalLeadRefs(role);
    const authorName = session.user.alias || session.user.name || "";
    attemptSync("pastor message notify register", () =>
      after(() =>
        attempt("pastor message notify", () =>
          notifyLeadsAboutServiceMessage({
            leadIds,
            authorId: adminId,
            authorName,
            roleId,
            roleType: role._type,
            serviceDate: target.serviceDate,
            identity: serviceIdentity(role),
            body,
            pastor: true,
          }),
        ),
      ),
    );
  }

  // Guarded read-back for the response only: the write already committed.
  let fresh: PastorMessageRow | null | undefined;
  try {
    fresh = await operationalClient.fetch<PastorMessageRow | null>(
      `*[_type == "${SERVICE_THREAD_TYPE}" && _id == $threadId][0].${PASTOR_MESSAGE}`,
      { threadId },
    );
  } catch (err) {
    console.error("[pastorMessage] post-commit read failed:", err);
  }
  return NextResponse.json({
    ok: true,
    // `undefined` (read failed) → the client keeps what it sent.
    pastor_message: fresh === undefined ? (next ? { ...next, author: adminId } : null) : (fresh ?? null),
  });
}
