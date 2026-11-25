import { after, NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { swapMinistryLessons } from "@/app/utils/ministryEventCommit";
import { sendClassNotices } from "@/app/utils/ministryEventNotify";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { eventRouteGate, readJson } from "../../../eventRoute";

// Wrapped because it imports a `*Commit` (`srVerificationRunContext.test.ts`). The writer sends
// nothing itself: it answers what the classes' holders are owed, computed from its pre-commit rows
// (ADR-0089, addendum of 2026-11-25), sent here after the response — best-effort, never the write.
export const POST = withVerificationRunContext(postHandler);

// The emails are awaited inside `after()`; each send may take its 20 s timeout.
export const maxDuration = 60;

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
  // Captured before the response; the callback never reads a class again.
  const classes = outcome.ok ? outcome.effects.classNotices : null;
  if (classes) after(() => sendClassNotices(classes));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
