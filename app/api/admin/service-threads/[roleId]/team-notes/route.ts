import { NextRequest, NextResponse } from "next/server";

import { requireActiveManager } from "@/app/utils/authGuards";
import { serviceError } from "@/app/utils/serviceMutation";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { saveTeamNotes } from "@/app/utils/serviceThreadCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

// Declared BEFORE the handler: `protectedReadAudit` treats `export const PUT =` as
// the start of the PUT region.
// Wrapped because the module it calls can deliver (`srVerificationRunContext.test.ts`
// scans by import); this writer sends nothing, and an unmarked request behaves as before.
export const PUT = withVerificationRunContext(putHandler);

/**
 * PUT /api/admin/service-threads/[roleId]/team-notes — edit the «Mensaje para el
 * equipo» of a service's LIVE setlist after it is published (ADR-0065, amended
 * 2026-10-24). Everything after authorization is `saveTeamNotes`
 * (`app/utils/serviceThreadCommit.ts`), which the MCP tool calls too; the
 * observed-target rule and its reasons live there.
 */
async function putHandler(req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  const session = await requireActiveManager();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { roleId } = await params;
  if (!isCanonicalDocumentId(roleId)) {
    return reject(serviceError("invalid_request", { details: { issues: ["roleId"] } }));
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const outcome = await saveTeamNotes(roleId, raw);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
