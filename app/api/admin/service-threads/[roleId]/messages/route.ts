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
import { serviceConversationQuery } from "@/app/utils/serviceReadQueries";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/**
 * GET — one service's whole conversation for the «Mensajes del servicio» dialog
 * that the admin opens from a service card: the service thread, plus the shared
 * proposal's own thread when the leads have created one. Same audience as POST.
 * Wrapped like POST only because `srVerificationRunContext.test.ts` requires every
 * handler of a delivery-capable module to be; this one sends nothing.
 */
export const GET = withVerificationRunContext(getHandler);

async function getHandler(_req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  const session = await requireActiveManager();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { roleId } = await params;
  const threadId = serviceThreadId(roleId);
  if (!isCanonicalDocumentId(roleId) || !threadId) {
    return reject(serviceError("invalid_request", { details: { issues: ["roleId"] } }));
  }
  const bound = serviceConversationQuery(roleId, threadId);
  const data = await operationalClient.fetch<ConversationRead | null>(bound.query, bound.params);
  if (!data?.service) return reject(serviceError("not_found", { details: { roleId } }));
  const { weekendSetlists, service, ...rest } = data;
  const { _rev, team_notes, hasSongs, ...publicService } = service;
  return NextResponse.json({
    ...rest,
    service: publicService,
    teamNotes: teamNotesTarget(service, weekendSetlists, { _rev, team_notes, hasSongs }),
  });
}

interface ConversationRead {
  service: {
    _id: string;
    _rev: string;
    _type: string;
    team_notes?: string | null;
    hasSongs?: boolean;
    [k: string]: unknown;
  } | null;
  weekendSetlists?: Array<{ _id: string; _rev: string; _type: string; team_notes?: string | null }> | null;
  [k: string]: unknown;
}

/**
 * Where this service's «Mensaje para el equipo» lives, for the team-notes PUT to
 * assert: a special's role (when it has a setlist), or the ONE weekend setlist
 * document of its type. No setlist, or an ambiguous pair, is `null` — the dialog
 * then shows the note read-only or says there is no setlist yet, and the PUT
 * would refuse the same way.
 */
function teamNotesTarget(
  service: NonNullable<ConversationRead["service"]>,
  weekendSetlists: ConversationRead["weekendSetlists"],
  own: { _rev: string; team_notes?: string | null; hasSongs?: boolean },
): { text: string; observed: { id: string; rev: string } } | null {
  if (service._type === "special_role") {
    return own.hasSongs ? { text: own.team_notes ?? "", observed: { id: service._id, rev: own._rev } } : null;
  }
  const type = service._type === "sunday_role" ? "featuredSongs" : "saturdarSongs";
  const rows = (weekendSetlists ?? []).filter((r) => r._type === type);
  if (rows.length !== 1) return null;
  return { text: rows[0].team_notes ?? "", observed: { id: rows[0]._id, rev: rows[0]._rev } };
}

// Declared BEFORE the handler, like the proposal message routes:
// `protectedReadAudit` treats `export const POST =` as the start of the POST region.
export const POST = withVerificationRunContext(postHandler);

/**
 * POST /api/admin/service-threads/[roleId]/messages — an admin writes to a
 * service's leads from the service card, with or without a proposal (ADR-0065).
 *
 * The message lands in `serviceThread.<roleId>`, NOT in a proposal: minting a
 * proposal to hold a message would make the role undeletable and immovable
 * (`roleDependencies` blocks on any proposal) and turn its readiness into
 * "Revisar propuesta". Every reader (the card's dialog, the proposal card, the
 * lead's editor) shows this thread together with the proposal's own.
 *
 * Deliberate, and the same as `admin/proposals/[id]/messages`:
 *  - **No `ifRevisionId`.** Two admins posting at once must both land.
 *    `createIfNotExists` + `setIfMissing` + `append` in one transaction is what
 *    makes the first message and every later one the same write.
 *  - **`isThreadOpen` is enforced here**, not only in the UI.
 *  - **`kind`** is `admin_change_request`, the admin kind the proposal messages
 *    route uses too. The pastor's message has its own writer (`…/pastor-message`).
 *
 * Written here even when a proposal exists: one writer and one notification
 * rule behind the card's button, never a choice decided by a race with the
 * lead's first save. The proposal's readers show it anyway.
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
    // The pastor's message is no longer a chat message (it is the thread's ONE
    // `pastor_message`, `…/pastor-message`); `pastor_note` items posted before
    // 2026-10-24 still render with their label.
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
