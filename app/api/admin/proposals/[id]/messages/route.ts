import { NextRequest, NextResponse } from "next/server";

// Kept at 60 s to match its sibling writers. This route registers no OUTBOX
// fan-out — an admin message queues no debounced email, which was Child A §1's
// named gap — but since Child B its writer does register an `after()`: the push
// that closes that gap by telling the lead. The budget is what keeps that
// deferred work alive after the response returns.
export const maxDuration = 60;

import { requireActiveManager } from "@/app/utils/authGuards";
import { serviceError } from "@/app/utils/serviceMutation";
import { postAdminProposalMessage } from "@/app/utils/proposalMessageCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

// Declared BEFORE the handler on purpose, matching `app/api/me/proposals/route.ts`.
// `protectedReadAudit`'s `operationRegions` treats `export const POST =` as the
// START of the POST region; hoisting keeps the order the audit expects.
export const POST = withVerificationRunContext(postHandler);

/**
 * POST /api/admin/proposals/[id]/messages — an admin posts into the private thread.
 *
 * Everything after authorization and the JSON read — the parse, the canonical
 * load, the open-thread rule, the cap, the append without `ifRevisionId`, the
 * lead push and the read-back — lives in `postAdminProposalMessage`
 * (`app/utils/proposalMessageCommit.ts`), which the native app's door calls too
 * (A-W1; ADR-0091). Its doc comment keeps the reasons this writer never touches
 * `admin_notes`, stores `admin_change_request`, and has no ministry check
 * (FrankERP/owt-kb-v1#8).
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
    const res = serviceError("invalid_request", { details: { issues: ["json"] } });
    return NextResponse.json(res.body, { status: res.status });
  }
  const { status, body } = await postAdminProposalMessage({ adminId, proposalId: id, raw });
  return NextResponse.json(body, { status });
}
