// app/api/admin/roles/swap/route.ts
import { NextRequest, NextResponse } from "next/server";

// Notifying the newly added assignees of two services can mean several
// sequential emails; give the after() work room to finish past the response.
export const maxDuration = 60;
import { requireActiveManager } from "@/app/utils/authGuards";
import { serviceError } from "@/app/utils/serviceMutation";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { swapRoles } from "@/app/utils/roleSwapCommit";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/**
 * Atomic swap of assignments between service roles (A2 §4).
 *
 * Three shapes:
 *   `{ kind: "seat",  source: { roleId, rev, path, itemKey }, target: { … } }`
 *   `{ kind: "section", path, roles: [{ id, rev }, { id, rev }] }`
 *   `{ kind: "team",  roles: [{ id, rev }, { id, rev }] }`
 *
 * The assignments written are derived from the CURRENT stored roles — a
 * replacement team payload is never accepted. A seat swap addresses items by
 * their stable stored `_key` (never a rendered index) and sets only the person
 * reference, so the destination `_key`, instrument label and FOH label are
 * preserved: the person moves, the seat does not. A section swap exchanges one
 * complete stored array, while a team swap exchanges exactly the five seat
 * fields. Identity, date, service name, publication state, songs and team notes
 * are untouched.
 *
 * Same-role swaps, topology-compatible team swaps, and individual-seat swaps
 * assert every involved role revision and coordination token in ONE transaction, so a
 * partial swap is impossible: any conflict rolls the whole thing back and returns
 * `409` with no business mutation.
 *
 * This handler authorizes and parses JSON only. Everything after that is
 * `swapRoles` (`app/utils/roleSwapCommit.ts`), the one swap writer the MCP
 * `swap_assignment` tool calls too; its outcome's `body` and `status` are sent
 * as-is.
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
  const outcome = await swapRoles(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
