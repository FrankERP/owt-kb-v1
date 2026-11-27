import { NextRequest, NextResponse } from "next/server";

// This route hosts the same post-commit `after()` fan-out as the save route:
// `queueLeadNotesNotice` registers a deferred `commitUpserts`, which runs an
// inline `sweepOutbox` at roughly 14 s per send. Give it room past the response.
export const maxDuration = 60;

import { requireMinistryMember } from "@/app/utils/authGuards";
import { serviceError } from "@/app/utils/serviceMutation";
import { postProposalMessage } from "@/app/utils/proposalMessageCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

// Declared BEFORE the handler on purpose, matching `app/api/me/proposals/route.ts`
// (whose save body now lives in `app/utils/proposalSaveCommit.ts`).
// `protectedReadAudit`'s `operationRegions` treats `export const POST =` as the
// START of the POST region, so declaring it at the bottom files every mutation in
// this file under `module` and the writer entry reads as dead. Hoisting makes it
// work at runtime either way; the audit is what fixes the order.
export const POST = withVerificationRunContext(postHandler);

/**
 * POST /api/me/proposals/[id]/messages — a lead posts into the private thread.
 *
 * The domain body (parse, canonical proposal, Lead check, thread open, append,
 * notices, read-back) lives in `app/utils/proposalMessageCommit.ts`, shared with
 * the native app's door (W1b, ADR-0091). This route keeps only its own
 * authorization and the JSON read; the author name for the approved-proposal
 * push is the session's, as it always was.
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

  const result = await postProposalMessage({
    leadId,
    authorName: session.user.alias || session.user.name || "",
    proposalId: id,
    raw,
  });
  return NextResponse.json(result.body, { status: result.status });
}
