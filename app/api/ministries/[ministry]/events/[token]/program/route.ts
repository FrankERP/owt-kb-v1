import { after, NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { updateMinistryEventProgram } from "@/app/utils/ministryEventCommit";
import { sendMinistryEventNotices } from "@/app/utils/ministryEventNotify";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { eventRouteGate, readJson } from "../../../eventRoute";

// Wrapped because it imports a `*Commit` (`srVerificationRunContext.test.ts`). The writer sends
// nothing itself: it answers the notices its pre-commit `before` owes (ADR-0089), sent here after
// the response — best-effort, never part of the write.
export const PATCH = withVerificationRunContext(patchHandler);

// The emails are awaited inside `after()`; each send may take its 20 s timeout.
export const maxDuration = 60;

/**
 * The program lines of a meeting (ADR-0081 W3a, W4): the encargado or apoyo of a whole-ministry
 * meeting they can read, or anyone who may edit it. Only `program` is written.
 */
async function patchHandler(req: NextRequest, { params }: { params: Promise<{ ministry: string; token: string }> }) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { ministry, token } = await params;
  const closed = await eventRouteGate(session.user.sanityId, ministry);
  if (closed) return closed;
  const outcome = await updateMinistryEventProgram(session.user.sanityId, ministry, token, await readJson(req));
  // Captured before the response; the callback never reads the meeting again.
  const notices = outcome.ok ? outcome.effects.notices : null;
  if (notices) after(() => sendMinistryEventNotices(notices));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
