// app/api/admin/fairness/route.ts
import { NextRequest, NextResponse } from "next/server";

import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { requireActiveManager } from "@/app/utils/authGuards";
import {
  FAIRNESS_LEDGER_UNAVAILABLE_ERROR_NAME,
  fairnessErrorClass,
  fairnessErrorFrames,
  loadFairnessLedger,
} from "@/app/utils/fairnessLedgerRead";
import { FAIRNESS_UNAVAILABLE_MESSAGE, isMonthString } from "@/app/utils/fairnessVocabulary";
import { fairnessRecordEnvironment, resolveSolverEngine } from "@/app/utils/solverDeployment";

/**
 * `GET /api/admin/fairness?month=YYYY-MM[&horizon=1|2]` — the fairness ledger for a
 * target month (solver v3 C2 RD-3, RD-4; IF2-7, IF2-8): the 3-month window and the
 * cumulative balance per person and line, the horizon months' records with their
 * freezing-service counts and `recordBinds`, the effective engine and this deployment's
 * `environment`. Read-only; the «Equidad · vista previa» panel and (later) C6 read it.
 *
 * The gate is `solver-history`'s: manager-only, content-editor refused — the payload
 * exposes members' availability (L5). Every failure is ONE opaque `500
 * { error: "fairness_unavailable", message }` with NO `people` key, so a client can never
 * read a failed read as an empty ledger; `loadFairnessLedger` has already logged a read
 * failure, and anything else is logged here by class and stack — never a message, a
 * request or a payload (spec §6 «Key hygiene» (c)).
 */

export const dynamic = "force-dynamic";

async function gate() {
  const session = await requireActiveManager();
  if (!session) return null;
  if (session.user.role === "content-editor") return null;
  return session;
}

export async function GET(req: NextRequest) {
  const session = await gate();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const month = req.nextUrl.searchParams.get("month");
  const horizonParam = req.nextUrl.searchParams.get("horizon");
  if (!isMonthString(month) || (horizonParam !== null && horizonParam !== "1" && horizonParam !== "2")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await loadFairnessLedger({
      month,
      horizon: horizonParam === "2" ? 2 : 1,
      currentMonth: serviceTodayIso().slice(0, 7),
      engine: resolveSolverEngine(process.env),
      environment: fairnessRecordEnvironment(process.env),
    });
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (!(err instanceof Error) || err.name !== FAIRNESS_LEDGER_UNAVAILABLE_ERROR_NAME) {
      console.error(`[fairness route] unexpected failure reading the fairness ledger: ${fairnessErrorClass(err)}\n${fairnessErrorFrames(err)}`);
    }
    return NextResponse.json({ error: "fairness_unavailable", message: FAIRNESS_UNAVAILABLE_MESSAGE }, { status: 500 });
  }
}
