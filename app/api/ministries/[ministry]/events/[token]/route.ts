import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { deleteMinistryEvent, updateMinistryEvent } from "@/app/utils/ministryEventCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { eventRouteGate, readJson } from "../../eventRoute";

// Wrapped because it imports a `*Commit` (`srVerificationRunContext.test.ts`); the writer sends nothing.
export const PATCH = withVerificationRunContext(patchHandler);
export const DELETE = withVerificationRunContext(deleteHandler);

type Ctx = { params: Promise<{ ministry: string; token: string }> };

/** Edit or publish a meeting (ADR-0081 W2, W3, W5). Everything after the gate is the writer's. */
async function patchHandler(req: NextRequest, { params }: Ctx) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { ministry, token } = await params;
  const closed = await eventRouteGate(session.user.sanityId, ministry);
  if (closed) return closed;
  const outcome = await updateMinistryEvent(session.user.sanityId, ministry, token, await readJson(req));
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
  return NextResponse.json(outcome.body, { status: outcome.status });
}
