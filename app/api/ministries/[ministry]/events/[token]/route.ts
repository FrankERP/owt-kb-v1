import { after, NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { deleteMinistryEvent, updateMinistryEvent } from "@/app/utils/ministryEventCommit";
import { sendClassNotices, sendMinistryEventNotices } from "@/app/utils/ministryEventNotify";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { eventRouteGate, readJson } from "../../eventRoute";

// Wrapped because it imports a `*Commit` (`srVerificationRunContext.test.ts`). The writer sends
// nothing itself: it answers the notices its pre-commit `before` owes (ADR-0089), sent here after
// the response — best-effort, never part of the write.
export const PATCH = withVerificationRunContext(patchHandler);
export const DELETE = withVerificationRunContext(deleteHandler);

// The emails are awaited inside `after()`; each send may take its 20 s timeout.
export const maxDuration = 60;

type Ctx = { params: Promise<{ ministry: string; token: string }> };

/** Edit or publish a meeting (ADR-0081 W2, W3, W5). Everything after the gate is the writer's. */
async function patchHandler(req: NextRequest, { params }: Ctx) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { ministry, token } = await params;
  const closed = await eventRouteGate(session.user.sanityId, ministry);
  if (closed) return closed;
  const outcome = await updateMinistryEvent(session.user.sanityId, ministry, token, await readJson(req));
  // Captured before the response; the callback never reads the meeting again.
  const notices = outcome.ok ? outcome.effects.notices : null;
  const classes = outcome.ok ? outcome.effects.classNotices : null;
  if (notices) after(() => sendMinistryEventNotices(notices));
  if (classes) after(() => sendClassNotices(classes));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/** Delete a meeting under the revision the client saw (`{ _rev }` in the body). */
async function deleteHandler(req: NextRequest, { params }: Ctx) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { ministry, token } = await params;
  const closed = await eventRouteGate(session.user.sanityId, ministry);
  if (closed) return closed;
  const outcome = await deleteMinistryEvent(session.user.sanityId, ministry, token, await readJson(req));
  // A deleted class tells its holders (ADR-0089, addendum of 2026-11-25); a meeting owes nothing.
  const classes = outcome.ok ? outcome.effects.classNotices : null;
  if (classes) after(() => sendClassNotices(classes));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
