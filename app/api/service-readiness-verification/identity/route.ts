import { NextResponse } from "next/server";

import {
  buildVerificationIdentity,
  evaluateVerificationEnvironment,
} from "@/app/utils/srVerificationIdentity";

// Service Readiness A3 §4 — the deployed-route harness's first call.
//
// Its ONE job: let the harness prove, before it signs in or touches anything,
// that this deployment targets the isolated `service-readiness-verification`
// dataset in project `scbxomq9` — not production.
//
// There is deliberately NO auth gate: the harness calls this before it has a
// session, so a session check would make the proof impossible. The safety
// property is carried instead by `evaluateVerificationEnvironment`, which
// requires ALL of:
//
//   · SERVICE_READINESS_VERIFICATION_MARKER === "owt-service-readiness-verification-v1"
//   · resolved dataset    === "service-readiness-verification"  (and never "production")
//   · resolved project    === "scbxomq9"                        (and never "ebb8vcnk")
//   · ALLOW_SERVICE_READINESS_E2E_WRITES === "true"
//   · SERVICE_READINESS_DELIVERY_MODE    === "disabled"
//
// In an ordinary Preview or Production deployment every one of those fails, so
// this route answers a bare 404 with no diagnostic detail and does not admit that
// it exists. The failure codes stay server-side; they are never sent to a caller.
//
// The response carries non-secret identity only — project, dataset, marker,
// delivery mode, the E2E flag, and Vercel's git ref / commit SHA / deployment
// id+URL. It never returns a token, a secret, a protection-bypass value, or any
// document content, and `VERIFICATION_IDENTITY_KEYS` keeps that shape closed.
//
// NOTE: this exact path is one of the auth middleware's public exclusions (see
// `MIDDLEWARE_MATCHER` in app/utils/routeMatcher.ts). The exclusion is anchored
// to this exact path with `$`, so no future sibling route under
// /api/service-readiness-verification/ inherits public reachability.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const verdict = evaluateVerificationEnvironment(process.env);

  // Fail closed. No body, no reason, no hint that the route exists.
  if (!verdict.ok) return new NextResponse(null, { status: 404 });

  return NextResponse.json(buildVerificationIdentity(process.env), {
    status: 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
