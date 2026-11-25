import { after, NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { createMinistryEvent } from "@/app/utils/ministryEventCommit";
import { sendClassNotices, sendMinistryEventNotices } from "@/app/utils/ministryEventNotify";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { eventRouteGate, readJson } from "../eventRoute";

// Wrapped because it imports a `*Commit` (`srVerificationRunContext.test.ts`). The writer sends
// nothing itself: it answers the notices its pre-commit `before` owes (ADR-0089), sent here after
// the response — best-effort, never part of the write.
export const POST = withVerificationRunContext(postHandler);

// The emails are awaited inside `after()`; each send may take its 20 s timeout.
export const maxDuration = 60;

/**
 * Create a meeting (ADR-0081 W3, W6). The session and the rollout are checked here; everything
 * else — fresh access, who may create which audience, people, the id from the client's create
 * token — is `createMinistryEvent`.
 */
async function postHandler(req: NextRequest, { params }: { params: Promise<{ ministry: string }> }) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { ministry } = await params;
  const closed = await eventRouteGate(session.user.sanityId, ministry);
  if (closed) return closed;
  const outcome = await createMinistryEvent(session.user.sanityId, ministry, await readJson(req));
  // Captured before the response; the callback never reads the meeting again.
  const notices = outcome.ok ? outcome.effects.notices : null;
  const classes = outcome.ok ? outcome.effects.classNotices : null;
  if (notices) after(() => sendMinistryEventNotices(notices));
  if (classes) after(() => sendClassNotices(classes));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
