import { NextRequest, NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { setKidsAvailability } from "@/app/utils/kidsCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

// Wrapped because the module it calls is a `*Commit` (`srVerificationRunContext.test.ts`
// scans by import); the Kids writers send nothing, and an unmarked request behaves as before.
export const PATCH = withVerificationRunContext(patchHandler);

/**
 * A Kids manager records a volunteer's absences on their behalf. Everything
 * after authorization is `setKidsAvailability` (`app/utils/kidsCommit.ts`),
 * which the MCP `set_kids_absences` calls too; why `_rev` is mandatory, and the
 * 409 that answers a lost race, live there.
 */
async function patchHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const outcome = await setKidsAvailability(id, await req.json());
  return NextResponse.json(outcome.body, { status: outcome.status });
}
