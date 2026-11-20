import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { swapMinistryLessons } from "@/app/utils/ministryEventCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { eventRouteGate, readJson } from "../../../eventRoute";

// Wrapped because it imports a `*Commit` (`srVerificationRunContext.test.ts`); the writer sends nothing.
export const POST = withVerificationRunContext(postHandler);

/**
 * «Cambiar con…» (plan 2026-11-12 L4): two classes of one group trade their people, in one
 * transaction under both revisions. Decided by the writer.
 */
async function postHandler(req: NextRequest, { params }: { params: Promise<{ ministry: string; token: string }> }) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { ministry, token } = await params;
  const closed = await eventRouteGate(session.user.sanityId, ministry);
  if (closed) return closed;
  const outcome = await swapMinistryLessons(session.user.sanityId, ministry, token, await readJson(req));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
