import { NextRequest, NextResponse } from "next/server";

// The post-commit `after()` fan-out queues the debounced lead-notes notice and
// (from Task 11) hosts a sweep; give it room to finish past the response.
export const maxDuration = 60;

import { requireMinistryMember } from "@/app/utils/authGuards";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serviceError } from "@/app/utils/serviceMutation";
import { THREAD_MESSAGES } from "@/app/utils/proposalMessageRead";
import { saveProposal } from "@/app/utils/proposalSaveCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

// GET /api/me/proposals — the shared proposal for every service the current user
// is a Lead on (not only ones they authored). Mirrors the /me superset.
export async function GET() {
  // Setlist proposals are a worship surface; membership, not just a session.
  const session = await requireMinistryMember("worship");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // GET reads through the canonical (published-perspective) client so a
  // `drafts.*` proposal/role overlay can never surface in a member's list.
  const proposals = await operationalClient.fetch(
    `*[_type == "setlistProposal" && $id in service_ref->Lead[]._ref] | order(service_date asc) {
      _id, _rev, service_type, service_date, status, lead_notes, team_notes, admin_notes, submitted_at, reviewed_at,
      ${THREAD_MESSAGES},
      "service_ref": service_ref._ref
    }`,
    { id: session.user.sanityId }
  );

  return NextResponse.json(proposals);
}

/**
 * Create / save / resubmit the ONE shared proposal for a service (A2 §6). The domain body
 * lives in `saveProposal` (`app/utils/proposalSaveCommit.ts`), shared with the native app's
 * door; this route keeps only worship membership and the JSON read.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const POST = withVerificationRunContext(postHandler);

async function postHandler(req: NextRequest) {
  // Defence in depth — the canonical-role check below already requires the
  // caller to be a Lead on the service — but a worship write stays behind
  // worship membership regardless.
  const session = await requireMinistryMember("worship");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const result = await saveProposal({ leadId: session.user.sanityId, raw });
  return NextResponse.json(result.body, { status: result.status });
}
