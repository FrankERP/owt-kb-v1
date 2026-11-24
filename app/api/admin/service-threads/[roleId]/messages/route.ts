import { NextRequest, NextResponse } from "next/server";

// Matches the sibling message writers: the push and email to the leads run in
// `after()`, and the budget is what keeps them alive past the response.
export const maxDuration = 60;

import { requireActiveManager } from "@/app/utils/authGuards";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serviceError } from "@/app/utils/serviceMutation";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { serviceThreadId, teamNotesTarget, type ConversationRead } from "@/app/utils/serviceThread";
import { postServiceThreadMessage } from "@/app/utils/serviceThreadCommit";
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

// Declared BEFORE the handler, like the proposal message routes:
// `protectedReadAudit` treats `export const POST =` as the start of the POST region.
export const POST = withVerificationRunContext(postHandler);

/**
 * POST /api/admin/service-threads/[roleId]/messages — an admin writes to a
 * service's leads from the service card, with or without a proposal (ADR-0065).
 * Everything after authorization is `postServiceThreadMessage`
 * (`app/utils/serviceThreadCommit.ts`), which the MCP message tool calls too;
 * its rules and their reasons live there.
 */
async function postHandler(req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  const session = await requireActiveManager();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Admin and super-admin only (not content-editor), like the proposal message route.
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { roleId } = await params;
  if (!isCanonicalDocumentId(roleId) || !serviceThreadId(roleId)) {
    return reject(serviceError("invalid_request", { details: { issues: ["roleId"] } }));
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const outcome = await postServiceThreadMessage(roleId, raw, {
    id: session.user.sanityId ?? null,
    name: session.user.alias || session.user.name || "",
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
