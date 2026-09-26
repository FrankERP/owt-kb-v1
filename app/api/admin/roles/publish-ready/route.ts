// app/api/admin/roles/publish-ready/route.ts
//
// The server-authoritative publish surface for Plan B item 3. Three modes, one
// contract:
//
//   { mode: "ready",    roles: [{ id, rev }] }
//   { mode: "override", roles: [{ id, rev, acknowledgedBlockers: [...] }] }   // batch
//   { mode: "recover",  roles: [{ id }], published: boolean }                 // READ ONLY
//
// `ready` and `override` never trust the client's readiness. Both RELOAD the five
// A1 read domains, recompute the SAME shared pure predicate the panel rendered
// from (`deriveServiceReadiness` + `classifyPublishBlockers`), build A2's exact
// revision guard bundle, and commit through A2's guarded publish-ready assertion
// helper in ONE transaction. The batch is atomic: if any selected service is no
// longer ready, or any guard cannot be built, nothing is committed and the answer
// is `409` with per-service reasons.
//
// `override` exists only for WORKFLOW blockers (empty team, availability conflict,
// active proposal, missing/incomplete setlist). The acknowledged set is compared
// against the server's freshly recomputed set and a change rejects the publish.
// It takes a BATCH: the card's individual button sends one entry, `Publicar todos`
// sends many, and each is checked against its OWN recomputed set — one mismatch
// rejects the whole request. An entry acknowledging nothing is a clean draft, so a
// single atomic batch can carry the ready and the acknowledged together.
// Hard integrity blockers — invalid or draft-conflicted records, duplicate
// targets, dangling assignments, unknown/failed sources, A2 cleanup requirements —
// are never override-eligible in either mode.
//
// Unpublishing is NOT here: it is a separate, narrower capability
// (`/api/admin/roles/unpublish`) that must stay available precisely when readiness
// is unsafe.
//
// This handler authorizes and parses JSON only. Everything after that is
// `publishReady` (`app/utils/publishReadyCommit.ts`), the one publish writer the
// MCP `publish_service` tool calls too; its outcome's `body` and `status` are
// sent as-is. Its per-service verdict is `publishVerdict`
// (`app/utils/publishVerdict.ts`), which the MCP reads call as well (I4).

import { NextRequest, NextResponse } from "next/server";

// Publishing a batch can fan out dozens of emails; give `after()` room to finish.
export const maxDuration = 60;

import { requireActiveManager } from "@/app/utils/authGuards";
import { serviceError } from "@/app/utils/serviceMutation";
import { publishReady } from "@/app/utils/publishReadyCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

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
  const outcome = await publishReady(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
