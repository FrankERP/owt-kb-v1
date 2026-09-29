// Test-only fetch harness for the fairness-history read — NOT a test file (no
// `.test.` in the name, so vitest's `include` never picks it up).
//
// Since the cutover (MCP P2 D2) `SOLVER_HISTORY_SOURCE` is `"derived"`, so a
// mounted `MonthGenerator` reads `GET /api/admin/solver-history?month=YYYY-MM`
// on its own: once for the display, and once more at the start of every Auto
// run (R14). The suites that are ABOUT something else — the create path, the
// stored editor, the calendar, the special filler — stub `fetch` with a mock
// whose CALL COUNT is the assertion ("exactly one POST", "nothing was
// written"). Left alone, the history read lands in that count.
//
// `stubFetchWithHistory` is `vi.stubGlobal("fetch", impl)` with the history read answered
// in front of `impl`: `impl` never sees it, so a `toHaveBeenCalledTimes(1)` on
// the mock still counts only what the test is about. The answer is a VALID,
// empty window (three months, no counts), so nothing is refused and nothing
// reads as a failed read; what the planner does with a real history is pinned
// where it belongs, in `MonthGenerator.derivedHistory.test.tsx`, which routes
// the history URL itself and never goes through this.
//
// Not for the rollback path: a suite that pins the switch to `"local"` never
// calls the history route and has no use for this.

import { vi } from "vitest";

import { historyWindow } from "@/app/utils/solverHistory";

const HISTORY_ROUTE = "/api/admin/solver-history?";

type Impl = (...args: never[]) => unknown;

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

/** The route's `200` for `month` (`YYYY-MM`): the window, nobody counted, no diagnostics. */
function emptyWindow(month: string): FakeResponse {
  const [year, m] = month.split("-").map(Number);
  const window = historyWindow({ year, month: m });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      target: { year, month: m },
      entries: window.map((w) => ({ key: w.key, year: w.year, month: w.month, total_counts: {}, role_counts: {} })),
      months: window.map((w) => ({ ...w, services: 4 })),
      diagnostics: { duplicateTargets: [], danglingSeats: [], unnamedMembers: [], duplicateNames: [] },
    }),
  };
}

/** Wraps `impl` so the history route is answered here and everything else reaches `impl` untouched. */
export function withDerivedHistory(impl: Impl): typeof fetch {
  return ((input: unknown, init?: unknown) => {
    if (typeof input === "string" && input.startsWith(HISTORY_ROUTE)) {
      const month = new URLSearchParams(input.slice(HISTORY_ROUTE.length)).get("month") ?? "";
      return Promise.resolve(emptyWindow(month));
    }
    return (impl as (i: unknown, n?: unknown) => unknown)(input, init);
  }) as typeof fetch;
}

/** `vi.stubGlobal("fetch", impl)`, with the history read answered ahead of `impl`. */
export function stubFetchWithHistory(impl: Impl): void {
  vi.stubGlobal("fetch", withDerivedHistory(impl));
}
