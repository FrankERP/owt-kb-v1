import { NextRequest, NextResponse } from "next/server";

import { requireActiveManager } from "@/app/utils/authGuards";
import {
  loadSolverHistory,
  SOLVER_HISTORY_UNAVAILABLE_ERROR_NAME,
  SOLVER_HISTORY_UNAVAILABLE_MESSAGE,
} from "@/app/utils/solverHistoryRead";

/**
 * `GET /api/admin/solver-history?month=YYYY-MM[&evidence=1]` — the read-only
 * admin route for the month solver's DERIVED fairness history (R8; MCP P2
 * plan `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`, task
 * 4). Nothing calls this route yet — P4's `solve_month` reads
 * `loadSolverHistory` directly, because the MCP authenticates with a bearer
 * token and cannot use a session-gated route.
 *
 * ─── Two gates, not one ───────────────────────────────────────────────────
 *
 * `gate()` is the SAME base gate as `solver-config`'s: manager-only,
 * content-editor excluded. `evidence=1` is a SECOND, narrower gate on top of
 * it — super-admin only — because the evidence's `members` list names EVERY
 * member, kids-only included, and a worship admin must see nothing of kids
 * (CLAUDE.md §Auth; the same rule `/api/admin/members` enforces with
 * `WORSHIP_MEMBER_GROQ_FILTER`). Without `evidence`, the payload already
 * names only members seated in the window's weekend roles (the builder's own
 * scoped diagnostics) — Gate B's only user is Frank, a super-admin.
 *
 * ─── Failure is opaque to the CLIENT, never silent on the SERVER ─────────
 *
 * `loadSolverHistory` throws `SolverHistoryUnavailableError` — a fixed
 * message, no Sanity text — on any failed read, and never returns empty
 * `entries` in place of one. The HTTP RESPONSE does not distinguish that
 * error from any other throw: EVERY throw becomes the same `500`, with NO
 * `entries` key, so a client can never mistake a failed read for an empty
 * history. But the SERVER LOG does distinguish them: `readList` in
 * `solverHistoryRead.ts` already logs a rejected Sanity read before it
 * throws `SolverHistoryUnavailableError`, so that path leaves a trace. A bug
 * in `deriveSolverHistory`/`buildSolverHistoryEvidence`, or a serialization
 * failure, would otherwise reach this `catch` and vanish — Vercel's logs
 * showing nothing for a request the client saw fail. That is exactly the
 * shape `solver-config/route.ts`'s POST handler condemns ("the real cause
 * swallowed by a `catch` that did not even log it"), so this route logs
 * anything that is not already logged upstream. The check is by `err.name`,
 * not `instanceof` — the class stays an implementation detail of
 * `solverHistoryRead.ts` and a test double never has to reproduce it.
 */

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Manager-gated, and content-editor excluded — matching `app/api/admin/solver-config/route.ts`. */
async function gate() {
  const session = await requireActiveManager();
  if (!session) return null;
  if (session.user.role === "content-editor") return null;
  return session;
}

export async function GET(req: NextRequest) {
  const session = await gate();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const evidenceRequested = req.nextUrl.searchParams.get("evidence") === "1";
  if (evidenceRequested && session.user.role !== "super-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get("month");
  if (!month || !MONTH_RE.test(month)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const [yearStr, monthStr] = month.split("-");
  const target = { year: Number(yearStr), month: Number(monthStr) };

  try {
    const result = await loadSolverHistory(target, { evidence: evidenceRequested });
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // The RESPONSE is the same opaque `500` whatever threw (see the header):
    // never leak internals, never carry an `entries` key a client could read
    // as "an empty history". The SERVER LOG is not — `SolverHistoryUnavailableError`
    // is already logged inside `readList` (`solverHistoryRead.ts`), so logging
    // it again here would just duplicate that line; anything else reached this
    // `catch` UNLOGGED and must not vanish silently.
    if (!(err instanceof Error) || err.name !== SOLVER_HISTORY_UNAVAILABLE_ERROR_NAME) {
      console.error("[solver-history route] unexpected failure reading solver history:", err);
    }
    return NextResponse.json(
      { error: "history_unavailable", message: SOLVER_HISTORY_UNAVAILABLE_MESSAGE },
      { status: 500 },
    );
  }
}
