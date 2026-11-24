import { NextResponse } from "next/server";
import { readConflictPanel } from "@/app/utils/availabilityFixCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { conflictAdmin } from "./guard";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * «Disponibilidad › Conflictos» (ADR-0079): open conflicts with their proposal recomputed on this
 * read, the ones applied in the last 30 days, the kept ones, and — when this read cannot judge —
 * why. Reads only; everything after the guard is `availabilityFixCommit.ts`.
 */
export const GET = withVerificationRunContext(getHandler);

async function getHandler() {
  const guard = await conflictAdmin();
  if (!guard.ok) return guard.response;
  const read = await readConflictPanel();
  if (!read.ok) return NextResponse.json({ error: "unavailable", reason: read.reason }, { status: 503 });
  return NextResponse.json(read);
}
