import { NextResponse } from "next/server";
import { SWEEP_WINDOW_MS, sweepAvailabilityConflicts, sweepDisabled } from "@/app/utils/availabilityFixCommit";
import { fairnessRecordEnvironment } from "@/app/utils/solverDeployment";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { conflictAdmin } from "../guard";

export const maxDuration = 60;

/**
 * «Revisar ahora» (ADR-0080): the whole sweep on demand. It acts only on Production with the kill
 * switch off; anywhere else it answers what it would do (dry).
 */
export const POST = withVerificationRunContext(postHandler);

async function postHandler() {
  const startedAt = Date.now();
  const guard = await conflictAdmin();
  if (!guard.ok) return guard.response;
  const acts = fairnessRecordEnvironment(process.env) === "production" && !sweepDisabled();
  const report = await sweepAvailabilityConflicts({ trigger: "manual", deadlineMs: startedAt + SWEEP_WINDOW_MS, mode: acts ? "act" : "dry" });
  return NextResponse.json(report, { status: report.ok ? 200 : 503 });
}
