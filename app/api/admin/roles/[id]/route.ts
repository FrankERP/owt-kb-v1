import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { requireActiveManager } from "@/app/utils/authGuards";
import { editRole } from "@/app/utils/roleEditCommit";
import { deleteRole } from "@/app/utils/roleDeleteCommit";
import { serviceError } from "@/app/utils/serviceMutation";
import { parseDeleteRequest, parseEditRequest } from "@/app/utils/roleWriteRequest";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Guard the session for both handlers. Returns a response when denied. */
async function denyUnlessManager(): Promise<NextResponse | null> {
  const session = await requireActiveManager();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Edit one service role (A2 §2).
 *
 * This handler authorizes, parses JSON and the edit request only. Everything after
 * that is `editRole` (`app/utils/roleEditCommit.ts`), the one edit writer the MCP
 * stored-service save calls too (admin parity phase 1, T2.1); its outcome's `body`
 * and `status` are sent as-is.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const PATCH = withVerificationRunContext(patchHandler);

async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await denyUnlessManager();
  if (denied) return denied;

  const { id } = await params;
  const body = await readJson(req);
  const parsed = parseEditRequest(body);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const outcome = await editRole(id, parsed.value);
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/**
 * Delete one service role (A2 §2/§3).
 *
 * This handler authorizes, parses JSON and the delete request only. Everything after
 * that is `deleteRole` (`app/utils/roleDeleteCommit.ts`), the one delete writer the MCP
 * deletes call too (admin parity phase 2, T1); its outcome's `body` and `status` are
 * sent as-is.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const DELETE = withVerificationRunContext(deleteHandler);

async function deleteHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await denyUnlessManager();
  if (denied) return denied;

  const { id } = await params;
  const parsed = parseDeleteRequest(await readJson(req));
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const outcome = await deleteRole(id, parsed.value);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
