import { after, NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { updateMinistryEventPart } from "@/app/utils/ministryEventCommit";
import { sendMinistryEventNotices } from "@/app/utils/ministryEventNotify";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { eventRouteGate, readJson } from "../../../../eventRoute";

// Wrapped because it imports a `*Commit` (`srVerificationRunContext.test.ts`). The writer sends
// nothing itself: it answers the notices its pre-commit `before` owes, sent here after the response.
export const PATCH = withVerificationRunContext(patchHandler);

// The emails are awaited inside `after()`; each send may take its 20 s timeout.
export const maxDuration = 60;

/**
 * «Mi parte» (ADR-0089, W10): what the responsable of ONE fixed part of a meeting fills — its
 * description, its music choice, the youths who help. Whoever may edit the meeting or its program
 * may too. The writer changes that part's line and nothing else, whatever the body says.
 */
async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ ministry: string; token: string; part: string }> },
) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { ministry, token, part } = await params;
  const closed = await eventRouteGate(session.user.sanityId, ministry);
  if (closed) return closed;
  const outcome = await updateMinistryEventPart(session.user.sanityId, ministry, token, part, await readJson(req));
  // Captured before the response; the callback never reads the meeting again.
  const notices = outcome.ok ? outcome.effects.notices : null;
  if (notices) after(() => sendMinistryEventNotices(notices));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
