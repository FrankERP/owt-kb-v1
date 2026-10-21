// app/api/admin/roles/copy-instruments/route.ts
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { requireActiveManager } from "@/app/utils/authGuards";
import { serviceError } from "@/app/utils/serviceMutation";
import { copyInstruments } from "@/app/utils/copyInstrumentsCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/**
 * Copy one service's instrument lineup onto another day (A2 §4).
 *
 * Exact request: `{ source: { id, rev }, target: { id, rev } }` — both
 * client-observed role revisions are required. BOTH current singleton roles are
 * read server-side and a cached client instrument payload is never accepted, so
 * what lands on the target is always what the source stores right now.
 *
 * One transaction patches ONLY the target's `instruments` while asserting both
 * role revisions and heartbeating both coordination tokens. A stale or deleted
 * source, a stale target, a dangling assignment, an invalid target, or any
 * conflict leaves the target's assignments unchanged.
 *
 * This handler authorizes and parses JSON only. Everything after that is
 * `copyInstruments` (`app/utils/copyInstrumentsCommit.ts`), the one copy writer the
 * MCP `copy_instruments` tool calls too; its outcome's `body` and `status` are sent as-is.
 */
// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const POST = withVerificationRunContext(postHandler);

async function postHandler(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session || session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const outcome = await copyInstruments(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
