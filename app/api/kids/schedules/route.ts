import { NextRequest, NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { KIDS_MONTH_RE, readKidsMonthSchedules } from "@/app/utils/kidsScheduleReads";
import { saveKidsSunday } from "@/app/utils/kidsCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

// Declared BEFORE the handlers: `protectedReadAudit` treats `export const GET =`
// as the start of the GET region.
// Wrapped because the module the PUT calls is a `*Commit` (`srVerificationRunContext.test.ts`
// scans by import); the Kids writers send nothing, and an unmarked request behaves as before.
export const GET = withVerificationRunContext(getHandler);
export const PUT = withVerificationRunContext(putHandler);

/** The planner's month: every saved Sunday, drafts included (ADR-0022's one exemption). */
async function getHandler(req: NextRequest) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!KIDS_MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  return NextResponse.json(await readKidsMonthSchedules(month));
}

/**
 * Save one Sunday, whole. Everything after authorization is `saveKidsSunday`
 * (`app/utils/kidsCommit.ts`), which the MCP `save_kids_sundays` calls too; the
 * seat rules and their reasons live there.
 */
async function putHandler(req: NextRequest) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const outcome = await saveKidsSunday(await req.json());
  return NextResponse.json(outcome.body, { status: outcome.status });
}
