import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { requireActiveManager } from "@/app/utils/authGuards";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serviceError } from "@/app/utils/serviceMutation";
import { createRole } from "@/app/utils/roleCreateCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { adminRolesQuery } from "@/app/utils/serviceReadQueries";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

export async function GET() {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The admin rows, shared with the MCP month planner (`adminRolesQuery`).
  const q = adminRolesQuery();
  const roles = await operationalClient.fetch(q.query, q.params);

  return NextResponse.json(roles);
}

/**
 * Create one service role (A2 §2). Everything after authorization and the JSON
 * parse is `createRole` (`app/utils/roleCreateCommit.ts`), the one create writer
 * the MCP `apply_schedule` tool calls too (ADR-0043): receipt replay, member and
 * target checks, the one transaction and the post-commit side effects.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const POST = withVerificationRunContext(postHandler);

async function postHandler(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }

  const outcome = await createRole(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
