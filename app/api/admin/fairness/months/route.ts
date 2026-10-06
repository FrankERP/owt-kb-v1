// app/api/admin/fairness/months/route.ts
import { NextRequest, NextResponse } from "next/server";

import { requireActiveManager } from "@/app/utils/authGuards";
import { commitFairnessMonths } from "@/app/utils/fairnessMonthCommit";
import { serviceError } from "@/app/utils/serviceMutation";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/**
 * `PUT /api/admin/fairness/months` — record 1–2 consecutive months of the fairness
 * ledger's monthly eligibility record (solver v3 C2 WR-1 … WR-17; body IF2-4, answers
 * IF2-5, refusals IF2-6). Under engine v2 it answers `409 engine_not_v3` and writes
 * nothing — and the effective engine is v2 everywhere until C7's flip, or until Frank
 * sets `OWT_SOLVER_ENGINE` for a Preview rehearsal (docs/SECRETS.md).
 *
 * This handler authorizes (admin and super-admin; content-editor refused — the
 * `solver-config` gate) and parses JSON only. Everything after that is
 * `commitFairnessMonths` (`app/utils/fairnessMonthCommit.ts`, ADR-0043), whose outcome's
 * `body` and `status` are sent as-is. It always writes as actor `route`; it can neither
 * reconstruct nor delete. `recordedBy` is the session's EFFECTIVE member id — under
 * impersonation (super-admin only) the impersonated manager whose role authorized the
 * write, as `solver-config` stamps `updatedBy`.
 *
 * Wrapped in `withVerificationRunContext` because its commit module is listed in
 * `DELIVERY_CAPABLE_IMPORTS` (every `*Commit` is); it delivers nothing.
 */
export const PUT = withVerificationRunContext(putHandler);

async function putHandler(req: NextRequest) {
  const session = await requireActiveManager();
  const sanityId = session?.user.sanityId;
  if (!session || !sanityId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (session.user.role === "content-editor") return reject(serviceError("forbidden"));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: [{ path: "", message: "must be JSON" }] } }));
  }
  const outcome = await commitFairnessMonths(body, { recordedBy: sanityId });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
