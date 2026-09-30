// Pins the fairness-history switch's shipped value (MCP P2; plan
// `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`, step 9).
//
// Delivery 1 shipped the switch dormant at `"local"`; Delivery 2 cut over to
// `"derived"` (Frank's Gate C decision, 2026-09-28). Rolling back is flipping
// the constant through the normal pipeline — and THIS TEST CHANGES ON PURPOSE
// the day that happens (and again when D3 deletes the switch module): update
// the expectation here in the same change rather than treating a failure as a
// bug to work around. The suites that need a specific mode pin it themselves
// with `vi.mock` (`MonthGenerator.create.test.tsx` pins `"local"`,
// `MonthGenerator.derivedHistory.test.tsx` pins `"derived"`), so a flip breaks
// this file and `solverConfigSource.test.ts`, not the planner's suites.

import { describe, expect, it } from "vitest";

import { SOLVER_HISTORY_SOURCE, SOLVER_SENDS_HISTORY } from "../solverHistorySource";

describe("SOLVER_HISTORY_SOURCE", () => {
  it("ships \"derived\" — the cutover flipped this constant; rolling back flips it, and this assertion, in the same change", () => {
    expect(SOLVER_HISTORY_SOURCE).toBe("derived");
  });
});

describe("SOLVER_SENDS_HISTORY", () => {
  it("ships false — Auto balances within the month only (ADR-0046); restoring history flips it, and this assertion, in the same change", () => {
    expect(SOLVER_SENDS_HISTORY).toBe(false);
  });
});
