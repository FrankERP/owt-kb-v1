import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { shiftMinistryLesson } from "@/app/utils/ministryEventCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { eventRouteGate, readJson } from "../../../eventRoute";

// Wrapped because it imports a `*Commit` (`srVerificationRunContext.test.ts`); the writer sends nothing.
export const POST = withVerificationRunContext(postHandler);

/**
 * «Recorrer» a group's class (plan 2026-11-12 L3): its date becomes a draft «No hubo clase» row and
 * it and every later class of its roster move a week, in one transaction. Decided by the writer.
 */
async function postHandler(req: NextRequest, { params }: { params: Promise<{ ministry: string; token: string }> }) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { ministry, token } = await params;
  const closed = await eventRouteGate(session.user.sanityId, ministry);
  if (closed) return closed;
  const outcome = await shiftMinistryLesson(session.user.sanityId, ministry, token, await readJson(req));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
