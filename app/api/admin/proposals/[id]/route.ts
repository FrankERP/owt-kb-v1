import { NextRequest, NextResponse } from "next/server";

// The post-commit `after()` fan-out queues the debounced setlist notice and (from
// Task 11) hosts a sweep; give it room to finish past the response.
export const maxDuration = 60;

import { requireActiveManager } from "@/app/utils/authGuards";
import { serviceError } from "@/app/utils/serviceMutation";
import { reviewProposal } from "@/app/utils/proposalReviewCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

/**
 * Guarded proposal transitions (A2 §6): `approve`, `request_changes`, `reopen`
 * and `reconcile_target`.
 *
 * Body: `{ action, rev, adminNotes? }` where `rev` is the proposal revision the
 * admin ACTUALLY reviewed. Everything after authorization and the JSON parse —
 * the canonical load, every refusal, the ONE transaction and its post-commit
 * notices — lives in `app/utils/proposalReviewCommit.ts`, which the MCP proposal
 * tools call too (admin parity phase 3, S1; ADR-0043).
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const PATCH = withVerificationRunContext(patchHandler);

async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    const res = serviceError("invalid_request", { details: { issues: ["json"] } });
    return NextResponse.json(res.body, { status: res.status });
  }
  const reviewerId = typeof session.user.sanityId === "string" ? session.user.sanityId : null;
  const outcome = await reviewProposal(id, raw, { reviewerId });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
