import { NextRequest, NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { KIDS_MONTH_RE } from "@/app/utils/kidsScheduleReads";
import { proposeKidsMonth, readKidsSeed } from "@/app/utils/kidsMonthPlan";

// Re-exported for the route's tests, which pin the seed search's bounds here.
export { MAX_SEED, MAX_SEED_ATTEMPTS } from "@/app/utils/kidsMonthPlan";

/**
 * Compute a month proposal. READ-ONLY on purpose: the planner shows warnings and
 * diagnostics and lets the admin override before anything is stored, so nothing
 * here writes. `PUT /api/kids/schedules` is the only writer. Everything after
 * authorization and parsing is `proposeKidsMonth` (`app/utils/kidsMonthPlan.ts`),
 * which the MCP `generate_kids_month` calls too.
 */
export async function POST(req: NextRequest) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as { month?: string; seed?: number; exclude?: string[] };
  if (typeof body.month !== "string" || !KIDS_MONTH_RE.test(body.month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const requestedSeed = readKidsSeed(body.seed);
  if (requestedSeed === null) {
    return NextResponse.json({ error: "seed must be a non-negative number" }, { status: 400 });
  }
  const exclude = new Set(
    Array.isArray(body.exclude) ? body.exclude.filter((f) => typeof f === "string") : [],
  );

  return NextResponse.json(await proposeKidsMonth(body.month, requestedSeed, exclude));
}
