import { NextRequest, NextResponse } from "next/server";

// The push and email to the leads run in `after()`, like the message POST beside it.
export const maxDuration = 60;

import { requireActiveManager } from "@/app/utils/authGuards";
import { serviceError } from "@/app/utils/serviceMutation";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { serviceThreadId } from "@/app/utils/serviceThread";
import { setPastorMessage } from "@/app/utils/serviceThreadCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

// Declared BEFORE the handler: `protectedReadAudit` treats `export const PUT =` as
// the start of the PUT region.
export const PUT = withVerificationRunContext(putHandler);

/**
 * PUT /api/admin/service-threads/[roleId]/pastor-message — set, edit or clear
 * the service's ONE «Mensaje del pastor» (ADR-0065, amended 2026-10-24).
 * Everything after authorization is `setPastorMessage`
 * (`app/utils/serviceThreadCommit.ts`), which the MCP tool calls too; the
 * stamp rule, the notification rule and their reasons live there.
 */
async function putHandler(req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  const session = await requireActiveManager();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  const outcome = await setPastorMessage(roleId, raw, {
    id: session.user.sanityId ?? null,
    name: session.user.alias || session.user.name || "",
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
