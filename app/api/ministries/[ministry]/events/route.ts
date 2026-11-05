import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { createMinistryEvent } from "@/app/utils/ministryEventCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { eventRouteGate, readJson } from "../eventRoute";

// Wrapped because it imports a `*Commit` (`srVerificationRunContext.test.ts`); the writer sends nothing.
export const POST = withVerificationRunContext(postHandler);

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
  return NextResponse.json(outcome.body, { status: outcome.status });
}
