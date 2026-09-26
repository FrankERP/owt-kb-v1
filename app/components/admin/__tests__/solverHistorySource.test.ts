// Pins the fairness-history switch's shipped value (MCP P2 D1; plan
// `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`, D2).
//
// Delivery 1 ships dormant: `SOLVER_HISTORY_SOURCE` stays `"local"` until
// Frank reads the R11 diff report and cuts over. THIS TEST CHANGES ON
// PURPOSE the day D2 flips the switch to `"derived"` — that flip is the
// release, not a regression, so update the expectation here in the same
// change rather than treating a failure as a bug to work around.

import { describe, expect, it } from "vitest";

import { SOLVER_HISTORY_SOURCE } from "../solverHistorySource";

describe("SOLVER_HISTORY_SOURCE", () => {
  it("ships \"local\" — D2's cutover flips this constant, and this assertion, in the same change", () => {
    expect(SOLVER_HISTORY_SOURCE).toBe("local");
  });
});
