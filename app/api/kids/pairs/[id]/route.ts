import { NextRequest, NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { patchKidsPair } from "@/app/utils/kidsCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

// Wrapped because the module it calls is a `*Commit` (`srVerificationRunContext.test.ts`
// scans by import); the Kids writers send nothing, and an unmarked request behaves as before.
export const PATCH = withVerificationRunContext(patchHandler);

/**
 * Edit one pair: rename, move room, swap members, or retire it (`active: false`).
 * Everything after authorization is `patchKidsPair` (`app/utils/kidsCommit.ts`),
 * which the MCP `save_kids_pair` calls too; the ownership guard on the path id
 * and the field-by-field rule live there.
 */
async function patchHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const outcome = await patchKidsPair(id, await req.json());
  return NextResponse.json(outcome.body, { status: outcome.status });
}
