// app/api/admin/roles/unpublish/route.ts
//
// Unpublish is a SEPARATE safety capability (Plan B item 3, plan
// §"Unpublish is a separate safety capability"). It deliberately does not use
// publish readiness or override eligibility at all:
//
//   { roles: [{ id, rev }] }                 // hide these published services
//   { mode: "recover", roles: [{ id }] }     // READ ONLY outcome verification
//
// A published service may be hidden even when its team, availability, setlist or
// proposal is unsafe, incomplete, conflicted, invalid or unavailable — that is
// precisely when hiding it matters. No blocker acknowledgements are accepted, and
// no member / setlist / proposal observation is required or read.
//
// What IS required is narrow and about the write target only, proven from the
// A1/A2 role-target observation through A2's shared helpers:
//   - the id resolves to exactly ONE canonical role (never an arbitrary pick),
//   - it carries no raw `drafts.` overlay,
//   - its record is structurally usable and its observed revision still matches,
//   - no other canonical role or raw draft occupies the same service target,
//   - the weekend coordination token is owned by THIS role (a special service is
//     serialized by its own revision and takes no lock).
// Any of those failing is a `409`, and nothing is written.
//
// `published: false` then goes through A2's guarded publication contract: one
// revision-asserted transaction that also heartbeats every involved token. An
// unpublish is silent by design (A2 §7) — only a real `false -> true` notifies.
//
// This handler authorizes and parses JSON only. Everything after that is
// `unpublishRoles` (`app/utils/roleUnpublishCommit.ts`), the one unpublish
// writer the MCP `unpublish_service` tool calls too; its outcome's `body` and
// `status` are sent as-is.

import { NextRequest, NextResponse } from "next/server";

// An unpublish notifies nobody and runs no sweep. 60 s is kept for parity with
// its sibling.
export const maxDuration = 60;

import { requireActiveManager } from "@/app/utils/authGuards";
import { serviceError } from "@/app/utils/serviceMutation";
import { unpublishRoles } from "@/app/utils/roleUnpublishCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

// A3 §3: outbound-delivery evidence emitted anywhere under this handler carries the
// in-flight verification run's markers. This handler registers no `after()` block and
// delivers nothing today (an unpublish is silent); the wrapper is kept because the
// route imports a delivery-capable module, which the coverage scan requires to be wrapped.
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
  const outcome = await unpublishRoles(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
